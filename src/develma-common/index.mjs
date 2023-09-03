import {Redis} from "ioredis";
import {Client} from "ssh2";
import { InvokeCommand } from "@aws-sdk/client-lambda"; // ES Modules import
import { DescribeInstancesCommand, DescribeInstanceStatusCommand, StartInstancesCommand, StopInstancesCommand} from "@aws-sdk/client-ec2";
import {DecryptCommand} from "@aws-sdk/client-kms";
import { GetObjectCommand } from "@aws-sdk/client-s3";

export function connectRedisClient(host, port) {
    const client = new Redis(port, host);
    client.on('error', (err) => console.error(err));
    return client;
}

async function decrypt(kMSClient, value) {
    const command = new DecryptCommand({
        CiphertextBlob: Buffer.from(value, 'base64'),
        KeyId: "arn:aws:kms:ap-northeast-2:884587563648:key/968b55e9-d8cf-47b3-837c-e30246e22298",
        EncryptionContext: {
            LambdaFunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME
        }
    });
    const {Plaintext}  = await kMSClient.send(command);
    return new TextDecoder().decode(Plaintext)
}

export async function describeInstances(eC2Client, instanceIds) {
    let instances = [];
    let describeInstancesCommand = new DescribeInstancesCommand({
        InstanceIds: instanceIds
    });

    while (true) {
        const {Reservations, NextToken}  = await eC2Client.send(describeInstancesCommand);
        instances = Reservations.reduce((previousValue, currentValue) =>  [...previousValue, ...currentValue.Instances], instances)
            .map(instance => ({
                instanceId: instance.InstanceId,
                stateCode: instance.State.Code,
                privateIpAddress: instance.PrivateIpAddress,
                hibernationConfigured: instance.HibernationOptions && instance.HibernationOptions.Configured,
            }))
        if (NextToken) {
            describeInstancesCommand = new DescribeInstancesCommand({NextToken});
        } else {
            break
        }
    }

    let instanceStatuses = [];
    let describeInstanceStatusCommand = new DescribeInstanceStatusCommand({
        InstanceIds: instanceIds
    });
    while (true) {
        const {InstanceStatuses, NextToken}  = await eC2Client.send(describeInstanceStatusCommand);
        instanceStatuses = [...instanceStatuses, ...InstanceStatuses]
        if (NextToken) {
            describeInstanceStatusCommand = new DescribeInstanceStatusCommand({NextToken});
        } else {
            break
        }
    }

    return instances.map(instance => {
        const instanceStatus = instanceStatuses.find(item => item.InstanceId === instance.instanceId)
        return {
            ...instance,
            isStatusOk: !!(instanceStatus
                && instanceStatus.InstanceStatus && instanceStatus.InstanceStatus.Status === 'ok'
                && instanceStatus.SystemStatus && instanceStatus.SystemStatus.Status === 'ok')
        }
    })

}

export async function startInstances(eC2Client, instanceIds) {
    let command = new StartInstancesCommand({
        InstanceIds: instanceIds
    });
    return eC2Client.send(command);
}
export async function stopInstances(eC2Client, instanceIds, hibernateFg) {
    let command = new StopInstancesCommand({
        InstanceIds: instanceIds,
        Hibernate: hibernateFg
    });
    return eC2Client.send(command);
}

export async function invokeLambda(lambdaClient, {functionName, payload}) {
    const input = { // InvocationRequest
        FunctionName: functionName, // required
        Payload: JSON.stringify(payload),
    };
    const command = new InvokeCommand(input);
    const {Payload, StatusCode} = await lambdaClient.send(command);
    if (StatusCode !== 200) {
        throw new Error(new TextDecoder().decode(Payload))
    }
    return new TextDecoder().decode(Payload)
}

export function connectSSH(options) {
    const conn = new Client();
    return new Promise((resolve, reject) => {
        conn.connect(options).on('ready', () => {
            resolve({
                conn,
                end: conn.end,
                exec: function (command){
                    return new Promise((resolve1, reject1) => {
                        const dataArr = []
                        conn.exec(command, (err, stream) => {
                            if (err) {
                                reject1(err)
                            }
                            let buffer = [];
                            let errBuffer = [];
                            stream.on('close', function () {
                                return errBuffer.length?reject1(errBuffer.join('')):resolve1(buffer.join(''));
                            }).on('data', function (data) {
                                buffer.push(data.toString())
                            }).stderr.on('data', function (data) {
                                errBuffer.push(data.toString());
                            });
                        })
                    })
                }
            })
        }).on('error', (e) => {
            reject(e)
        })
    })
}


export const loadS3Env = async (s3client, kMSClient, bucket, path) => {
    const cached = {};

    const command = new GetObjectCommand({
        Bucket: bucket || process.env.ENV_FILE_S3_BUCKET,
        Key: path || process.env.ENV_FILE_S3_PATH
    });

    const response = await s3client.send(command);
    const str = await response.Body.transformToString();
    const env = {
        ...process.env,
        ...(JSON.parse(str))
    }

    return async (key, isEncrypted) => {
        if (!cached[key]) {
            cached[key] = isEncrypted ? await decrypt(kMSClient, env[key]) : env[key]
        }
        return cached[key];
    }
}
