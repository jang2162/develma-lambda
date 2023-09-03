import {MinecraftServerListPing} from "minecraft-status";

export const handler = async ({ipAddr}) => {
    const serverStatus = await MinecraftServerListPing.ping(4, ipAddr)
    return {
        result: serverStatus.players.online === 0
    };
}
