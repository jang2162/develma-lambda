import {connectRedisClient} from "develma-common";

export const handler = async ({redisHost, redisPort}) => {
    const redisClient = connectRedisClient(redisHost, redisPort)
    const hibernateInstanceSet = await redisClient.smembers('hibernateInstance')
    const instancePropsArr = await Promise.all(hibernateInstanceSet.map(key => redisClient.hgetall(`hibernateInstanceProps:${key}`)))
    const instanceStatusArr = await Promise.all(hibernateInstanceSet.map(key => redisClient.hgetall(`hibernateInstanceStatus:${key}`)))
    redisClient.disconnect()
    return hibernateInstanceSet
        .reduce((prev, current, idx) =>
            [...prev, {
                key: current,
                ...instancePropsArr[idx],
                ...instanceStatusArr[idx]
            }], []).filter(item => item.useYn === 'Y')
}
