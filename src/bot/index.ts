/**
 * Bot bootstrap: creates and starts the Telegram bot over long polling.
 * Provides minimal health commands and registers the full command set.
 */
import { Bot, Keyboard, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { registerCommands } from "./chat_bot_commands.js";

const token = process.env.BOT_TOKEN;
if (!token) {
	console.error("BOT_TOKEN env is required");
	process.exit(1);
}

const bot: Bot<Context> = new Bot(token);

bot.command("start", (ctx: Context) => {
	const kb = new Keyboard()
		.text("➕ New room")
		.text("🔗 Join room")
		.row()
		.text("🃏 My hand")
		.text("🂠 Draw")
		.row()
		.text("⏭️ Pass")
		.text("📊 State")
		.resized();
	ctx.reply(
		"UNO Lite bot is alive. Use buttons below or commands.",
		{ reply_markup: kb }
	);

	const inline = new InlineKeyboard()
		.text("➕ New room", "new")
		.text("❓ Help", "help_inline");
	return ctx.reply("Quick actions:", { reply_markup: inline });
});

bot.command("ping", (ctx: Context) => ctx.reply("pong 🏓"));

registerCommands(bot);

bot.catch((err: unknown) => {
	console.error("Bot error:", err);
});

bot.start();
console.log("Bot started with long polling.");

