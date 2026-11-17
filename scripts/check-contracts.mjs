import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'packages/api-client/src'], { encoding: 'utf8' });
assert.equal(changes, '', 'Generated client drift: run npm run generate:api and commit the complete output.');
console.log('Generated Angular client matches the OpenAPI contract.');
