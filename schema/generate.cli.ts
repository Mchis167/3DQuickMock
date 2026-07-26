import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { OUTPUT_RELATIVE_PATH, serialize } from './generate'

const target = path.resolve(process.cwd(), OUTPUT_RELATIVE_PATH)
writeFileSync(target, serialize())
console.log(`-> ${target}`)
