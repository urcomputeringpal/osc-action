/* eslint-disable no-undef */
const process = require('process');
const cp = require('child_process');
const path = require('path');

// shows how the runner will run a javascript action with env / stdout protocol
test('test runs', () => {
    process.env['INPUT_HOST'] = 'localhost';
    process.env['INPUT_PORT'] = '51235';
    process.env['INPUT_ENDPOINT'] = '/run-code';
    process.env['INPUT_SEPARATOR'] = '|';
    process.env['INPUT_MESSAGE'] = 'ACTIONS|play 60';
    const ip = path.join(__dirname, 'index.js');
    console.log(cp.execSync(`mkdir -p logs; node ${ip} >logs/test.log 2>&1`, { env: process.env }).toString());
})
