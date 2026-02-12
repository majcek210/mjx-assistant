//import { AiHandler } from "./lib/ai/handler"
import  client from "./lib/bot/main"
import { config} from "dotenv"
config()


//const rl = readline.createInterface({ input, output })
//const handler = new AiHandler()







async function main() {
  client.start(process.env.BOT_TOKEN)
}

main()
