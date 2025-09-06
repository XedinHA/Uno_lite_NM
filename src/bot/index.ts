/**
 * Bot bootstrap: creates and starts the Telegram bot over long polling.
 * Provides minimal health commands and registers the full command set.
 */
import { Bot } from "grammy";
import { registerCommands } from "./commands.js";

const token = process.env.BOT_TOKEN;
if (!token) {
	console.error("BOT_TOKEN env is required");
	process.exit(1);
}

const bot = new Bot(token);

bot.command("start", (ctx) =>
	ctx.reply(
		"UNO Lite bot is alive. Use /ping to test.\nSoon: /new, /join, /startgame, /hand, /play, /draw, /pass, /state."
	)
);

bot.command("ping", (ctx) => ctx.reply("pong 🏓"));

registerCommands(bot);

bot.catch((err) => {
	console.error("Bot error:", err);
});

bot.start();
console.log("Bot started with long polling.");

