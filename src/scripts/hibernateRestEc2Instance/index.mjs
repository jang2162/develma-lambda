import {config} from 'dotenv'
import {handler} from "../../functions/hibernateRestEc2Instance/index.mjs";
config()
console.log(await handler());
