import {connectRedisClient} from "develma-common";

export const handler = async ({redisHost, redisPort, redisHSetArr}) => {
    const redisClient = connectRedisClient(redisHost, redisPort)
    await Promise.all(redisHSetArr.map(async item => await redisClient.hset(`hibernateInstanceStatus:${item.key}`, ...item.params)))
}
