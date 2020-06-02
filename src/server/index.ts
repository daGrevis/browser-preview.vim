import util from 'util'
import fs from 'fs'
import path from 'path'
import http from 'http'
import child_process from 'child_process'

import _ from 'lodash'
import { https } from 'follow-redirects'
import msgpack from 'msgpack'
import Koa from 'koa'
import koaSend from 'koa-send'
import socketio from 'socket.io'
import convertHrtime from 'convert-hrtime'

// Vim is sending this to the server.
type UpdatePayload = {
  filepath: string
  lines: string[]
  cursor: [number, number, number, number, number] // :help getcurpos()
  renderer: string
  styles: string[]
  className: string
}

// Server is sending this to the web client.
type RenderPayload = {
  title: string
  output: string
  filepath: string
  styles: { [styleUrl: string]: string }
  className: string
}

// Server state.
type State = {
  isRendering: boolean
  latestRender: RenderPayload
  styleCache: { [styleUrl: string]: string }
}

const FILE_OPTIONS = {
  encoding: 'utf8',
}

const DEBUG_LOG = path.resolve(__dirname, '../debug.log')

const debug = (data: any) => {
  const dataRepr =
    typeof data === 'string'
      ? data
      : util.inspect(data, {
          depth: null,
          colors: false,
        })

  return fs.promises.appendFile(DEBUG_LOG, dataRepr + '\n', FILE_OPTIONS)
}

const resetDebug = () => fs.promises.writeFile(DEBUG_LOG, '', FILE_OPTIONS)

const resolveHome = (filepath: string) => {
  if (filepath[0] === '~') {
    return process.env.HOME
      ? path.join(process.env.HOME, filepath.slice(1))
      : filepath
  }
  return filepath
}

const loadStyle = (styleUrl: string) =>
  new Promise((resolve, reject) => {
    let url

    try {
      url = new URL(styleUrl)
    } catch (e) {}

    if (url) {
      const req = https.request(url)

      req.on('response', (res) => {
        const chunks: Buffer[] = []

        res.on('data', (chunk) => {
          chunks.push(chunk)
        })

        res.on('end', () => {
          resolve(chunks.join(''))
        })
      })

      req.on('error', (e) => {
        reject(e)
      })

      req.end()
    } else {
      resolve(fs.promises.readFile(resolveHome(styleUrl), FILE_OPTIONS))
    }
  })

const main = async () => {
  await resetDebug()

  let state: State = {
    isRendering: false,
    latestRender: {
      title: '',
      output: '',
      filepath: '',
      styles: {},
      className: '',
    },
    styleCache: {},
  }

  const stdin = process.stdin

  stdin.resume()

  const MsgpackStream = (msgpack as any).Stream
  var eventStream = new MsgpackStream(stdin)

  const onDebouncedUpdate = _.debounce(async (payload: UpdatePayload) => {
    if (state.isRendering) {
      // If still rendering the previous update, reschedule update for later.
      onDebouncedUpdate(payload)
      return
    }

    state.isRendering = true

    const start = process.hrtime()

    const { lines, renderer, styles, className } = payload

    state.styleCache = {
      ...state.styleCache,
      ..._.fromPairs(
        await Promise.all(
          _.map(styles, async (styleUrl) => {
            let cachedStyle = state.styleCache[styleUrl]
            if (cachedStyle) {
              return [styleUrl, cachedStyle]
            }
            const style = await loadStyle(styleUrl)
            return [styleUrl, style]
          }),
        ),
      ),
    }

    const rendererProcess = child_process.exec(renderer)

    rendererProcess.on('error', (e) => {
      debug(e)
    })

    const input = lines.join('\n')

    rendererProcess.stdin?.write(input)

    let outputChunks: Buffer[] = []

    rendererProcess.stdout?.on('data', (chunk) => {
      outputChunks.push(chunk)
    })

    rendererProcess.stdout?.on('end', () => {
      state.isRendering = false
      state.latestRender = {
        title: path.basename(payload.filepath),
        output: outputChunks.join(''),
        filepath: payload.filepath,
        styles: _.pick(state.styleCache, styles),
        className,
      }

      webio.sockets.emit('render', state.latestRender)

      outputChunks = []

      const { milliseconds } = convertHrtime(process.hrtime(start))

      debug(`onUpdate ${_.round(milliseconds)}ms`)
    })

    rendererProcess.stdin?.end()
  }, 100)

  eventStream.on('msg', (message: any) => {
    let event
    let payload

    try {
      event = message[1]
      payload = message[2][0]
    } catch (e) {
      debug(`Could not recognize message: ${message}`)
      return
    }

    if (event === 'update') {
      onDebouncedUpdate(payload)
    }
  })

  const koa = new Koa()

  koa.use(async (ctx) => {
    try {
      await koaSend(ctx, ctx.path === '/' ? 'index.html' : ctx.path, {
        root: 'dist',
      })
    } catch (e) {
      await koaSend(ctx, ctx.path, {
        root: path.dirname(state.latestRender.filepath),
      })
    }
  })

  const webio = socketio({
    serveClient: false,
  })

  webio.on('connection', (socket) => {
    socket.emit('render', state.latestRender)

    socket.on('error', (e) => {
      debug(e)
    })
  })

  const server = http.createServer(koa.callback())

  webio.attach(server)

  server.listen(7777)

  debug('listening 7777')
}

main()

export { RenderPayload }
