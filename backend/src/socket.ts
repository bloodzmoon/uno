import WebSocket from 'ws'
import Http from 'http'
import Database from './core/db'
import Game from './core/game'
import Player from './core/player'
import Message from './utils/message'
import { InMessage } from './models/message'

/**
 * Create a WebSocket Server that will handle
 * all sockets connection
 */
const init = (server: Http.Server) => {
  const wss = new WebSocket.Server({ server })
  const db = new Database()

  const broadcast = (game: Game, message: string) => {
    game.players.forEach((p) => p?.socket?.send(message))
  }

  wss.on('connection', (socket) => {
    socket.on('message', (message: string) => {
      const msg: InMessage = JSON.parse(message)

      switch (msg.type) {
        case 'join':
          {
            const { gameId, playerName } = msg.payload
            const game = db.getGame(gameId)
            const playerId = game.getEmptyId()
            const player = new Player(playerId, playerName, socket)
            const oldCards = game.players[playerId].cards
            const drawnCards = oldCards.length ? oldCards : player.draw(game, 5)
            player.cards = drawnCards
            game.addPlayer(player)

            game.state = game.isGameFull() ? 'playing' : 'waiting'
            socket.send(Message.init(game, playerId, drawnCards))
            broadcast(game, Message.update(game))
          }
          break

        case 'play':
          {
            const { gameId, playerId, card } = msg.payload
            const game = db.getGame(gameId)
            const player = game.players[playerId]
            if (!card) {
              const cards = player.draw(game, 1)
              socket.send(Message.draw(cards))
            } else {
              player.play(card)
              game.playedCards.push(card)
              switch (card.content) {
                case 'Rev':
                  game.changeDirection()
                  break
                case 'Skip':
                  game.nextTurn()
                  break
                case '+2':
                  {
                    const nextPlayer = game.getNextPlayer()
                    const cards = nextPlayer.draw(game, 2)
                    nextPlayer.socket?.send(Message.draw(cards))
                    game.nextTurn()
                  }
                  break
                case '+4':
                  {
                    const nextPlayer = game.getNextPlayer()
                    const cards = nextPlayer.draw(game, 4)
                    nextPlayer.socket?.send(Message.draw(cards))
                    game.nextTurn()
                  }
                  break
              }
              broadcast(game, Message.card(card))
            }
            game.nextTurn()
            broadcast(game, Message.update(game))

            if (game.isGameOver()) {
              broadcast(game, Message.gameover(game.getResult()))
              db.removeGame(game.id)
            }
          }
          break
      }
    })

    socket.on('close', () => {
      const game: Game = db.disconnect(socket)!
      if (!game) return
      if (game.isGameOver()) return

      game.state = game.isGameFull() ? 'playing' : 'waiting'
      broadcast(game, Message.update(game))

      if (game.isGameEmpty()) db.removeGame(game.id)
    })
  })
}

export default {
  init,
}
