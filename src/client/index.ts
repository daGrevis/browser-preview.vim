import _ from 'lodash'
import socketio from 'socket.io-client'

import { RenderPayload } from '../server'

const websocket = socketio()

const $body = document.querySelector('body') as HTMLBodyElement

const $root = document.createElement('div')
$body.appendChild($root)

const $styles = document.createElement('div')
$root.appendChild($styles)

const $output = document.createElement('div')
$root.appendChild($output)

let currentPayload: RenderPayload | undefined

websocket.on('render', (payload: RenderPayload) => {
  const { title, styles, className, output } = payload

  document.title = title

  const isStylesUpdateNeeded =
    !currentPayload || !_.isEqual(_.keys(currentPayload.styles), _.keys(styles))
  if (isStylesUpdateNeeded) {
    $styles.innerHTML = ''
    _.forEach(styles, (style) => {
      const $style = document.createElement('style')
      $style.innerHTML = style

      $styles.append($style)
    })
  }

  $output.className = className ?? ''

  $output.innerHTML = output

  currentPayload = payload
})
