"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
//import { AiHandler } from "./lib/ai/handler"
const main_1 = __importDefault(require("./lib/bot/main"));
const dotenv_1 = require("dotenv");
(0, dotenv_1.config)();
//const rl = readline.createInterface({ input, output })
//const handler = new AiHandler()
async function main() {
    main_1.default.start(process.env.BOT_TOKEN);
}
main();
