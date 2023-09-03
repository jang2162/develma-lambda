import copydir from 'copy-dir';
import * as path from "path";
copydir.sync(path.join(process.cwd(), 'src', 'develma-common'), path.join(process.cwd(), 'node_modules', 'develma-common'));
