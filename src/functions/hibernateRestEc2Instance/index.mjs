import {loadS3Env, describeInstances, stopInstances, invokeLambda} from "develma-common";
import {S3Client} from "@aws-sdk/client-s3";
import {KMSClient} from "@aws-sdk/client-kms";
import {EC2Client} from "@aws-sdk/client-ec2";
import {LambdaClient} from "@aws-sdk/client-lambda";

let ENV;
let s3client;
let eC2Client;
let kMSClient;
let lambdaClient;
export const handler = async () => {
    s3client = new S3Client({region: 'ap-northeast-2'})
    kMSClient = new KMSClient({ region: 'ap-northeast-2'});
    eC2Client = new EC2Client({ region: 'ap-northeast-2'});
    lambdaClient = new LambdaClient({ region: 'ap-northeast-2' });

    ENV = await loadS3Env(s3client, kMSClient);
    const redisHost = await ENV('REDIS_HOST')
    const redisPort = await ENV('REDIS_PORT')

    const instanceDataArr =  await invokeLambda(lambdaClient, {
        functionName: await ENV('LAMBDA_GET_EC2_INSTANCES_DATA_FROM_REDIS'),
        payload: {
            redisHost, redisPort
        }
    });
    const instanceDescribeData = await describeInstances(eC2Client, instanceDataArr.map(item => item.instanceId))
    const instanceData = instanceDataArr
        .map((item, idx) => ({
            ...item,
            ...instanceDescribeData[idx],
        }))

    try {
        const result = await Promise.all(instanceData.map(data => runHibernateRestEc2Instance(data)));
        const redisHSetArr = result.map(item => item.redisHSet).filter(item => item);
        await invokeLambda(lambdaClient, {
            functionName: await ENV('LAMBDA_SET_EC2_INSTANCES_STATUS'),
            payload: {
                redisHost, redisPort, redisHSetArr
            }
        });
        return result.map(item => item.result);
    } finally {
        redisClient.disconnect()
    }
};


async function runHibernateRestEc2Instance(data) {
    const isRunning = data.stateCode === 16 && data.isStatusOk
    let isChecked = false;
    let isAction = false;

    let lastUpDt = data.lastUpTimestamp ? new Date(parseInt(data.lastUpTimestamp)) : null;
    let lastDownDt = data.lastDownTimestamp ? new Date(parseInt(data.lastDownTimestamp)) : null;
    let lastConditionDt = data.lastConditionTimestamp ? new Date(parseInt(data.lastConditionTimestamp)) : null;
    let lastCheckDt = data.lastCheckTimestamp ? new Date(parseInt(data.lastCheckTimestamp)) : null;
    let redisHSet = null;
    if (isRunning) {
        if (!lastUpDt) {
            lastUpDt = new Date()
        }

        isChecked = await checkInstanceCondition(data)
        lastCheckDt = new Date()
        if (isChecked) {
            if (!lastConditionDt) {
                lastConditionDt = new Date()
            }

            const conditionMaintainMinute = data.conditionMaintainMinute ? parseInt(data.conditionMaintainMinute) : 60
            const minActionDelayAfterStartMinute = data.minActionDelayAfterStartMinute ? parseInt(data.minActionDelayAfterStartMinute) : 30

            if (
                new Date().getTime() >= lastConditionDt.getTime() + (1000 * 60 * conditionMaintainMinute) &&
                new Date().getTime() >= lastUpDt.getTime() + (1000 * 60 * minActionDelayAfterStartMinute)
            ) {
                lastDownDt = new Date()
                isAction = true
                await stopInstances(eC2Client, [data.instanceId], data.hibernationConfigured)
            }
        }

        if (lastUpDt || lastDownDt || lastConditionDt || lastCheckDt) {
            redisHSet = {
                key: `${data.key}`,
                params: [...(lastUpDt ? ['lastUpTimestamp', `${lastUpDt.getTime()}`] : []),
                    ...(lastDownDt ? ['lastDownTimestamp', `${lastDownDt.getTime()}`] : []),
                    ...(lastConditionDt ? ['lastConditionTimestamp', `${lastConditionDt.getTime()}`] : []),
                    ...(lastCheckDt ? ['lastCheckTimestamp', `${lastCheckDt.getTime()}`] : []),
                ]
            }
        }
    }

    return {
        result:{
            key: data.key,
            isRunning,
            isAction,
            isChecked,
        },
        redisHSet
    }
}

async function checkInstanceCondition(data) {

    switch (data.conditionCheckType) {
        case 'OPENVPN_ACCESS_SERVER_IDLE': {
            let {result} = await invokeLambda(lambdaClient, {
                functionName: await ENV('LAMBDA_CHK_EC2_CONDI_OPEN_VPN_ACCESS_SERVER_IDLE'),
                payload: {
                    ipAddr: data.privateIpAddress,
                    privateKey: Buffer.from(await ENV('HIBERNATE_KEY', true), 'base64').toString()
                }
            });
            return result;
        }
        case 'MINECRAFT_SERVER_IDLE': {
            let {result} = await invokeLambda(lambdaClient, {
                functionName: await ENV('LAMBDA_CHK_EC2_CONDI_MINECRAFT_SERVER_IDLE'),
                payload: {
                    ipAddr: data.privateIpAddress,
                }
            });
            return result;
        }
        case 'SSH_DIR_LAST_MOD_DATE': {
            let {result} = await invokeLambda(lambdaClient, {
                functionName: await ENV('LAMBDA_CHK_EC2_CONDI_SSH_DIR_LAST_MOD_DATE'),
                payload: {
                    ipAddr: data.privateIpAddress,
                    checkParamDirPath: data.checkParamDirPath,
                    checkParamLastModifiedMinute: data.checkParamLastModifiedMinute,
                    privateKey: Buffer.from(await ENV('HIBERNATE_KEY', true), 'base64').toString()
                }
            });
            return result;
        }
    }
}
