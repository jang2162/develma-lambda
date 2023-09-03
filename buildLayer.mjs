import {spawn} from 'child_process';
import * as path from "path";


await (new Promise((resolve, reject) => {
    const stream = spawn('Bandizip', [
        'c',
        '-root:nodejs/node_modules',
        '.\\stack-node-common.zip',
        path.join(process.cwd(), 'node_modules')
    ])
    stream.stdout.on('data', function(data) {
        console.log(data.toString());
    });

    stream.stderr.on('data', function(data) {
        console.error(data.toString());
    });

    stream.on('exit', function(code) {
        if (code === 0) {
            resolve()
        } else {
            reject()
        }
    });
}))
