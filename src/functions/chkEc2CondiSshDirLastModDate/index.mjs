import {connectSSH} from "develma-common";

export const handler = async ({ipAddr, checkParamDirPath, checkParamLastModifiedMinute, privateKey}) => {
    const conn = await connectSSH({
        host: ipAddr,
        port: 22,
        username: 'hibernate',
        privateKey
    });
    const data = await conn.exec(`find ${checkParamDirPath}  -newermt "$(date -d '${checkParamLastModifiedMinute} minute ago')"`)
    conn.end()
    return {result: !data}
}
