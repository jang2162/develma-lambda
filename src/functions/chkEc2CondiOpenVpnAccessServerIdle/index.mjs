import {connectSSH} from "develma-common";

export const handler = async ({ipAddr, privateKey}) => {
    const conn = await connectSSH({
        host: ipAddr,
        port: 22,
        username: 'hibernate',
        privateKey
    });

    const dataStr = await conn.exec('cat ~/VPNStatus.json')
    conn.end()
    const data = JSON.parse(dataStr)
    for (const dataKey in data) {
        if (
            data[dataKey]
            && data[dataKey].client_list
            && data[dataKey].client_list.length
        ) {
            return {result: false}
        }
    }
    return {result: true}
}
