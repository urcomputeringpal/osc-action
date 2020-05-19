const core = require('@actions/core');
const OSC = require('osc-js');

async function run() {
  let osc
  try {
    const endpoint = core.getInput('endpoint', { required: true })
    const host = core.getInput('host', { required: true })
    const port = core.getInput('port', { required: true })
    const separator = core.getInput('separator')
    const message = core.getInput('message', { required: true })

    osc = new OSC({ plugin: new OSC.DatagramPlugin({ send: { host: host, port: port } }) })
    osc.open()  

    let msg = [message]
    if (separator != '') {
      msg = message.split(separator)
    }

    let oscMsg = new OSC.Message(endpoint)
    for (const part of msg) {  
      oscMsg.add(part)
    }

    osc.send(oscMsg)

    console.log("sent", oscMsg)
  } catch (error) {
    core.setFailed(error.message)
  } finally {
    try {
      osc.close()
    } catch (error) {
      core.setFailed(error.message)
    }
  }

}

run()
