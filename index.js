const core = require('@actions/core')
const dgram = require('dgram')
const OSC = require('osc-js')

async function run() {

  try {
    const endpoint = core.getInput('endpoint', { required: true })
    const host = core.getInput('host', { required: true })
    const port = core.getInput('port', { required: true })
    const separator = core.getInput('separator')
    const message = core.getInput('message', { required: true })

    let msg = [message]
    if (separator != '') {
      msg = message.split(separator)
    }

    const oscMessage = new OSC.Message(endpoint, ...msg)
    const binary = oscMessage.pack()

    const socket = dgram.createSocket('udp4')
    socket.on('error', (err) => {
      console.log(`socket error:\n${err.stack}`)
      socket.close()
    })

    socket.send(Buffer.from(binary), 0, binary.byteLength, port, host, (err) => {
      if (err) {
        core.setFailed(err.message)
      }
      socket.close();
    })

  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
