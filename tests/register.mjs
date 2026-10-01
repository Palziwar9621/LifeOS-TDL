import { register } from 'node:module';
import { installMemIdb } from './mem-idb.ts';

register('./ts-resolver.mjs', import.meta.url);
installMemIdb();
