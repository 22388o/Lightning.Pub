/**
 * @format
 */
const Common = require('shock-common')
const logger = require('winston')
const { safeParseJSON } = require('../json')
const ECC = require('./index')

const nonEncryptedEvents = [
  'ping',
  'disconnect',
  'IS_GUN_AUTH',
  'SET_LAST_SEEN_APP',
  Common.Constants.ErrorCode.NOT_AUTH
]

/**
 * @typedef {import('../../services/gunDB/Mediator').SimpleSocket} SimpleSocket
 * @typedef {import('../../services/gunDB/Mediator').Emission} Emission
 * @typedef {import('../../services/gunDB/Mediator').EncryptedEmission} EncryptedEmission
 * @typedef {import('../../services/gunDB/Mediator').EncryptedEmissionLegacy} EncryptedEmissionLegacy
 */

/**
 * @param {string} eventName
 */
const isNonEncrypted = eventName => nonEncryptedEvents.includes(eventName)

/**
 * @param {SimpleSocket} socket
 * @returns {(eventName: string, args?: Emission | EncryptedEmission | EncryptedEmissionLegacy) => Promise<void>}
 */
const encryptedEmit = socket => async (eventName, ...args) => {
  try {
    if (isNonEncrypted(eventName)) {
      return socket.emit(eventName, ...args)
    }

    const deviceId = socket.handshake.query.encryptionId

    if (!deviceId) {
      throw {
        field: 'deviceId',
        message: 'Please specify a device ID'
      }
    }

    const authorized = ECC.isAuthorizedDevice({ deviceId })

    if (!authorized) {
      throw {
        field: 'deviceId',
        message: 'Please exchange keys with the API before using the socket'
      }
    }

    const encryptedArgs = await Promise.all(
      args.map(data => {
        if (!data) {
          return data
        }

        return ECC.encryptMessage({
          message: typeof data === 'object' ? JSON.stringify(data) : data,
          deviceId
        })
      })
    )

    console.log('Encrypted args:', encryptedArgs)

    return socket.emit(eventName, ...encryptedArgs)
  } catch (err) {
    logger.error(
      `[SOCKET] An error has occurred while encrypting an event (${eventName}):`,
      err
    )

    return socket.emit('encryption:error', err)
  }
}

/**
 * @param {SimpleSocket} socket
 * @returns {(eventName: string, callback: (data: any) => void) => void}
 */
const encryptedOn = socket => (eventName, callback) => {
  try {
    if (isNonEncrypted(eventName)) {
      return socket.on(eventName, callback)
    }

    const deviceId = socket.handshake.query.encryptionId

    if (!deviceId) {
      throw {
        field: 'deviceId',
        message: 'Please specify a device ID'
      }
    }

    const authorized = ECC.isAuthorizedDevice({ deviceId })

    if (!authorized) {
      throw {
        field: 'deviceId',
        message: 'Please exchange keys with the API before using the socket'
      }
    }

    socket.on(eventName, async data => {
      if (isNonEncrypted(eventName)) {
        callback(data)
        return
      }

      if (data) {
        const decryptedMessage = await ECC.decryptMessage({
          deviceId,
          encryptedMessage: data
        })

        callback(safeParseJSON(decryptedMessage))
      }
    })
  } catch (err) {
    logger.error(
      `[SOCKET] An error has occurred while decrypting an event (${eventName}):`,
      err
    )

    return socket.emit('encryption:error', err)
  }
}

module.exports = {
  isNonEncrypted,
  encryptedOn,
  encryptedEmit
}
