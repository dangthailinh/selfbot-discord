import { Client } from 'discord.js-selfbot-v13';
import dotenv from 'dotenv';
import { handleCommands } from './handlers/commandHandler.mjs';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import readline from 'readline';
import { handleMessage as handleAFKMessage } from './commands/afk.mjs';
import handleMessage from './handlers/messageHandler.mjs';
import chalk from 'chalk';
import boxen from 'boxen';
import gradient from 'gradient-string';
import handleMessageDelete from './handlers/messageDelete.mjs';
import handleMessageUpdate from './handlers/messageUpdate.mjs';
import { startDashboard } from './dashboard/server.mjs';
import {
    configureGeminiClients,
    handleGeminiMention
} from './handlers/geminiMentionHandler.mjs';
import { handleSelfChatCommand } from './handlers/selfChatHandler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const commandsPath = path.join(__dirname, 'commands');

dotenv.config();
dotenv.config({ path: path.join(__dirname, '.env.local'), override: true });

const gradientText = gradient('cyan', 'pink');

const boxenOptions = {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan',
    backgroundColor: '#000000',
    title: 'LINH OSIMI - SELFBOT DISCORD',
    titleAlignment: 'center'
};

const welcomeMessage = boxen(
    gradientText(`
    LINH OSIMI
    `) +
    chalk.cyan(`
    Version: 1.0.0
    Author: Linh Osimi
    Discord: linhosimi.
    Description: Một selfbot tùy chỉnh cho Discord,
    được phát triển bởi Linh Osimi gồm nhiều tính năng
    hiện đại và tiện lợi, sử dụng thư viện discord.js-selfbot-v13

    `) +
    chalk.yellow(`Features:
    • Nhẹ, nhanh và ổn định
    • Hệ thống lệnh đơn giản, dễ sử dụng
    • Hỗ trợ định dạng tin nhắn kiểu rõ ràng, đẹp mắt
    • Nhiều tiện ích hỗ trợ cá nhân
    • Luôn cập nhật tính năng mới...
    `),
    boxenOptions
);

const clients = []; // Array để quản lý nhiều clients

export { clients };

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function getPrefix() {
    if (existsSync(CONFIG_PATH)) {
        try {
            const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
            return config.prefix || ';';
        } catch (err) {
            console.error('Lỗi khi đọc prefix từ config:', err);
            return ';';
        }
    }
    return ';';
}

async function loadConfig() {
    console.log(chalk.yellow('\nChọn một tùy chọn để khởi động bot:'));
    console.log(chalk.cyan('1. Load từ file .env (tự động quét DISCORD_TOKEN_1, _2, ... )'));
    console.log(chalk.cyan('2. Nhập số lượng token mới và lưu vào file config.json (thay thế)'));
    console.log(chalk.cyan('3. Load từ file config.json hiện tại'));
    console.log(chalk.cyan('4. Thêm token mới vào config.json hiện tại (giữ nguyên cũ)'));

    const choice = await askQuestion(chalk.yellow('Nhập lựa chọn của bạn (1, 2, 3, hoặc 4): '));

    let tokens = [];

    switch (choice.trim()) {
        case '1':
            dotenv.config();
            console.log(chalk.green('✅ Đã load từ file .env'));
            // Quét tất cả DISCORD_TOKEN_* từ env
            for (let i = 1; ; i++) {
                const tokenKey = `DISCORD_TOKEN_${i}`;
                const token = process.env[tokenKey];
                if (!token) break;
                tokens.push(token);
            }
            if (tokens.length === 0) {
                console.log(chalk.red('❌ Không tìm thấy token nào trong .env (cần DISCORD_TOKEN_1, _2, ...). Vui lòng thêm và thử lại.'));
                rl.close();
                return null;
            }
            console.log(chalk.green(`✅ Tìm thấy ${tokens.length} token từ .env`));
            break;
        case '2':
            const numTokens = parseInt(await askQuestion(chalk.cyan('🔑 Nhập số lượng token muốn thêm: ')));
            if (isNaN(numTokens) || numTokens <= 0) {
                console.log(chalk.red('❌ Số lượng phải là số dương!'));
                rl.close();
                return null;
            }
            tokens = [];
            for (let i = 1; i <= numTokens; i++) {
                const token = await askQuestion(chalk.cyan(`🔑 Nhập token ${i}: `));
                if (token.trim()) tokens.push(token.trim());
            }
            const config = { tokens, prefix: ';' };
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
            console.log(chalk.green(`✅ Đã lưu ${tokens.length} token vào file config.json`));
            break;
        case '3':
            if (fs.existsSync(CONFIG_PATH)) {
                const configData = fs.readFileSync(CONFIG_PATH);
                const config = JSON.parse(configData);
                console.log(chalk.green('✅ Đã load từ file config.json'));
                tokens = config.tokens || [];
                if (tokens.length === 0) {
                    console.log(chalk.red('❌ Không có token trong config.json. Vui lòng chọn tùy chọn khác.'));
                    rl.close();
                    return null;
                }
                console.log(chalk.green(`✅ Tìm thấy ${tokens.length} token từ config.json`));
            } else {
                console.log(chalk.red('❌ File config.json không tồn tại. Vui lòng chọn tùy chọn khác.'));
                rl.close();
                return null;
            }
            break;
        case '4':
            if (!fs.existsSync(CONFIG_PATH)) {
                console.log(chalk.red('❌ File config.json không tồn tại. Vui lòng chọn tùy chọn 2 hoặc 3 trước.'));
                rl.close();
                return null;
            }
            const existingConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            tokens = existingConfig.tokens || [];
            console.log(chalk.green(`✅ Config hiện tại có ${tokens.length} token`));

            const addNum = parseInt(await askQuestion(chalk.cyan('🔑 Nhập số lượng token muốn thêm: ')));
            if (isNaN(addNum) || addNum <= 0) {
                console.log(chalk.red('❌ Số lượng phải là số dương!'));
                rl.close();
                return null;
            }
            for (let i = 1; i <= addNum; i++) {
                const token = await askQuestion(chalk.cyan(`🔑 Nhập token mới ${i}: `));
                if (token.trim()) tokens.push(token.trim());
            }
            existingConfig.tokens = tokens;
            fs.writeFileSync(CONFIG_PATH, JSON.stringify(existingConfig, null, 2));
            console.log(chalk.green(`✅ Đã thêm ${addNum} token, tổng cộng ${tokens.length} token`));
            break;
        default:
            console.log(chalk.red('❌ Lựa chọn không hợp lệ. Vui lòng thử lại.'));
            rl.close();
            return null;
    }

    return {
        tokens,
        source: choice.trim() === '1' ? 'env' : 'config'
    };
}

const LOGIN_DELAY_MIN_MS = 2000;
const LOGIN_DELAY_MAX_MS = 4000;
const LOGIN_TIMEOUT_MS = 45000;
const MAX_TRANSIENT_LOGIN_ATTEMPTS = 3;
const LOGIN_FAILURE_REPORT = path.join(__dirname, 'login_failures.json');

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function classifyLoginError(error) {
    const message = String(error?.message || error || 'Unknown login error');
    const normalized = message.toLowerCase();
    const code = String(error?.code ?? '').toUpperCase();
    const httpStatus = Number(error?.httpStatus ?? error?.status ?? 0);

    if (
        code === '4004' ||
        code === 'TOKEN_INVALID' ||
        httpStatus === 401 ||
        normalized.includes('invalid token') ||
        normalized.includes('token_invalid')
    ) {
        return { kind: 'invalid_token', retryable: false };
    }

    if (
        normalized.includes('captcha') ||
        normalized.includes('required action') ||
        normalized.includes('verify')
    ) {
        return { kind: 'verification_required', retryable: false };
    }

    if (
        httpStatus === 429 ||
        normalized.includes('rate limit') ||
        normalized.includes('too many requests')
    ) {
        return { kind: 'rate_limited', retryable: true };
    }

    if (
        ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(code) ||
        normalized.includes('network') ||
        normalized.includes('socket') ||
        normalized.includes('timed out') ||
        normalized.includes('timeout') ||
        httpStatus >= 500
    ) {
        return { kind: 'network', retryable: true };
    }

    return { kind: 'unknown', retryable: false };
}

function sanitizeLoginErrorMessage(value) {
    return String(value || 'Unknown login error')
        .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_TOKEN]');
}

function toSafeLoginFailure(index, error, attempt) {
    const classification = classifyLoginError(error);
    return {
        index,
        kind: classification.kind,
        reason: sanitizeLoginErrorMessage(error?.message || error),
        code: error?.code ?? null,
        httpStatus: error?.httpStatus ?? error?.status ?? null,
        attempt
    };
}

async function loginClientWithRetry(rawToken, index) {
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!token) {
        return {
            client: null,
            failure: {
                index,
                kind: 'invalid_token',
                reason: 'Token is empty or not a string.',
                code: 'TOKEN_INVALID',
                httpStatus: null,
                attempt: 0
            }
        };
    }

    let lastFailure = null;
    for (let attempt = 1; attempt <= MAX_TRANSIENT_LOGIN_ATTEMPTS; attempt++) {
        const candidate = new Client();
        candidate.commands = new Map();

        let timeoutId = null;
        try {
            await Promise.race([
                candidate.login(token),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(() => {
                        const timeoutError = new Error(`Login timed out after ${LOGIN_TIMEOUT_MS / 1000} seconds.`);
                        timeoutError.code = 'ETIMEDOUT';
                        reject(timeoutError);
                    }, LOGIN_TIMEOUT_MS);
                })
            ]);
            if (timeoutId) clearTimeout(timeoutId);
            return { client: candidate, failure: null };
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            lastFailure = toSafeLoginFailure(index, error, attempt);
            const { retryable } = classifyLoginError(error);
            try {
                candidate.destroy();
            } catch (_) {}

            if (!retryable || attempt === MAX_TRANSIENT_LOGIN_ATTEMPTS) break;

            const retryDelay = Math.min(30000, 5000 * (2 ** (attempt - 1)));
            console.log(chalk.yellow(
                `⚠️ Client ${index} lỗi tạm thời (${lastFailure.kind}), thử lại sau ${Math.round(retryDelay / 1000)} giây...`
            ));
            await wait(retryDelay);
        }
    }

    return { client: null, failure: lastFailure };
}

function saveLoginFailureReport(totalTokens, failedTokens) {
    const report = {
        generatedAt: new Date().toISOString(),
        totalTokens,
        successful: totalTokens - failedTokens.length,
        failed: failedTokens.length,
        failures: failedTokens
    };

    try {
        fs.writeFileSync(LOGIN_FAILURE_REPORT, JSON.stringify(report, null, 2), 'utf8');
    } catch (error) {
        console.error(`Không thể lưu báo cáo đăng nhập: ${error.message}`);
    }
}

function removeInvalidTokensFromConfig(sourceTokens, failedTokens, source) {
    if (source !== 'config') {
        return { removed: 0, skipped: true, reason: 'tokens_loaded_from_env' };
    }

    const invalidTokenValues = new Set(
        failedTokens
            .filter(failure => failure?.kind === 'invalid_token')
            .map(failure => sourceTokens[failure.index - 1])
            .filter(token => typeof token === 'string' && token.trim())
            .map(token => token.trim())
    );
    if (invalidTokenValues.size === 0) {
        return { removed: 0, skipped: false, reason: 'no_invalid_tokens' };
    }

    try {
        const currentConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        const currentTokens = Array.isArray(currentConfig.tokens) ? currentConfig.tokens : [];
        const retainedTokens = currentTokens.filter(token =>
            typeof token !== 'string' || !invalidTokenValues.has(token.trim())
        );
        const removed = currentTokens.length - retainedTokens.length;
        if (removed === 0) {
            return { removed: 0, skipped: false, reason: 'config_changed_since_login' };
        }

        const backupPath = `${CONFIG_PATH}.bak`;
        fs.copyFileSync(CONFIG_PATH, backupPath);
        currentConfig.tokens = retainedTokens;
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(currentConfig, null, 2), 'utf8');
        return { removed, skipped: false, reason: 'removed', backupPath };
    } catch (error) {
        console.error(`Không thể tự động loại token lỗi khỏi config.json: ${error.message}`);
        return { removed: 0, skipped: false, reason: 'write_failed', error: error.message };
    }
}

async function startBot() {
    try {
        console.clear();
        console.log(welcomeMessage);

        const config = await loadConfig();
        if (!config) return;

        const { tokens, source } = config;
        if (tokens.length === 0) {
            console.log(chalk.red('❌ Không có token hợp lệ, vui lòng kiểm tra lại!'));
            process.exit(1);
        }

       // Tạo clients cho từng token
        clients.length = 0; // Clear array nếu cần
        const failedTokens = []; // Chỉ lưu index và nguyên nhân an toàn, không lưu token

        for (let i = 0; i < tokens.length; i++) {
            console.log(chalk.cyan(`\n🔐 Đang đăng nhập client ${i + 1}...`));
            const { client, failure } = await loginClientWithRetry(tokens[i], i + 1);

            if (client) {
                client.aiAccountIndex = i;
                clients.push(client);
                console.log(chalk.green(`✅ Client ${i + 1} đăng nhập thành công!`));
            } else {
                console.log(chalk.red(
                    `❌ Token ${i + 1} bị lỗi [${failure?.kind || 'unknown'}], bỏ qua: ${failure?.reason || 'Unknown error'}`
                ));
                failedTokens.push(failure);
            }

            if (i < tokens.length - 1) {
                const loginDelay =
                    LOGIN_DELAY_MIN_MS +
                    Math.floor(Math.random() * (LOGIN_DELAY_MAX_MS - LOGIN_DELAY_MIN_MS + 1));
                await wait(loginDelay);
            }
        }

        saveLoginFailureReport(tokens.length, failedTokens);
        const cleanupResult = removeInvalidTokensFromConfig(tokens, failedTokens, source);
        if (cleanupResult.removed > 0) {
            console.log(chalk.green(
                `🧹 Đã xóa ${cleanupResult.removed} token invalid khỏi config.json.`
            ));
            console.log(chalk.yellow(`💾 Bản sao trước khi xóa: ${cleanupResult.backupPath}`));
        }

        if (clients.length === 0) {
            console.log(chalk.red('❌ Không có token nào đăng nhập thành công. Vui lòng kiểm tra lại danh sách token!'));
            console.log(chalk.yellow(`📄 Xem báo cáo: ${LOGIN_FAILURE_REPORT}`));
            process.exit(1);
        }

        if (failedTokens.length > 0) {
            console.log(chalk.yellow(`\n⚠️ Có ${failedTokens.length} token bị lỗi và đã bị bỏ qua:`));
            failedTokens.forEach(t => {
                console.log(chalk.yellow(`   • Token ${t.index} [${t.kind}]: ${t.reason}`));
            });
            console.log(chalk.yellow(`📄 Báo cáo chi tiết: ${LOGIN_FAILURE_REPORT}`));
        }

        // Start the dashboard server
        startDashboard();

        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.mjs'));
        let loadedCommands = 0;
        let failedCommands = 0;

        for (const file of commandFiles) {
            try {
                const filePath = path.join(commandsPath, file);
                const fileUrl = new URL(`file://${filePath.replace(/\\/g, '/')}`).href;
                const command = await import(fileUrl);
                // Set commands cho tất cả clients
                clients.forEach(client => {
                    client.commands.set(command.name, command);
                });
                loadedCommands++;
            } catch (error) {
                console.error(`Lỗi khi tải lệnh ${file}:`, error);
                failedCommands++;
            }
        }

        if (failedCommands === 0) {
            console.log(`✅ Đã tải thành công ${loadedCommands} lệnh cho ${clients.length} clients!`);
        } else {
            console.log(`⚠️ Đã tải ${loadedCommands} lệnh, ${failedCommands} lệnh thất bại!`);
        }

        console.log(chalk.cyan('\n🤖 Thông tin selfbot:'));
        clients.forEach((client, index) => {
            console.log(chalk.cyan(`• Client ${index + 1} - Username: ${client.user.username}`));
            console.log(chalk.cyan(`  ID: ${client.user.id}`));
            console.log(chalk.cyan(`  Số server đang ở: ${client.guilds.cache.size}`));
        });
        console.log(chalk.cyan(`• Prefix hiện tại: ${getPrefix()}`));

        const showLogs = await askQuestion(chalk.yellow('\nBạn có muốn hiển thị tất cả tin nhắn trong console và lưu vào log không? (y/n): '));
        if (showLogs.toLowerCase() === 'y') {
            console.log(chalk.green('✅ Đã bật hiển thị tin nhắn'));
            process.env.SHOW_MESSAGE_HANDLER = 'true';
        } else {
            console.log(chalk.yellow('⚠️ Đã tắt hiển thị tin nhắn'));
            process.env.SHOW_MESSAGE_HANDLER = 'false';
        }

        console.log(chalk.green(`\n✨ Bot đã sẵn sàng với ${clients.length} clients!`));

        const geminiAccounts = configureGeminiClients(clients);
        geminiAccounts.forEach(account => {
            console.log(chalk.magenta(
                `[GEMINI] ${account.username} sử dụng nhân cách ${account.personality}`
            ));
        });

        // Đăng ký event handlers chung cho tất cả clients
        clients.forEach(client => {
            client.on('messageCreate', handleMessage);
            client.on('messageDelete', handleMessageDelete);
            client.on('messageUpdate', handleMessageUpdate);
            client.on('messageCreate', handleAFKMessage);
            client.on('messageCreate', message => handleGeminiMention(message, client));
            client.on('messageCreate', message => handleSelfChatCommand(message, clients));
        });

        // Command handler riêng cho từng client
        clients.forEach(client => {
            client.on('messageCreate', async (message) => {
                const prefix = getPrefix();
                if (!message.content.startsWith(prefix)) return;
                if (message.author.id !== client.user.id) return;

                const args = message.content.slice(prefix.length).trim().split(/ +/);
                const cmd = args.shift().toLowerCase();

                message.delete().catch(() => {});

                if (client.commands.has(cmd)) {
                    const command = client.commands.get(cmd);

                    const perm = command.permission || 'everyone';
                    const authorId = message.author.id;

                    if (perm === 'admin') {
                        const isAdmin = message.member?.permissions?.has('Administrator') || false;
                        if (!isAdmin) {
                            return message.channel.send('`❌ Lệnh này chỉ dành cho Admin.`')
                                .then(msg => setTimeout(() => msg.delete().catch(() => {}), 15000));
                        }
                    }

                    try {
                        const reply = await command.execute(message, args, client);
                        if (reply && typeof reply === 'string') {
                            const sent = await message.channel.send(`\`${reply}\``);
                            setTimeout(() => sent.delete().catch(() => {}), 15000);
                        }
                    } catch (err) {
                        console.error(`Lỗi khi chạy lệnh ${cmd} trên client ${client.user.username}:`, err);
                    }
                }
            });
        });

    } catch (error) {
        console.log(chalk.red(`\n❌ Lỗi khi đăng nhập: ${error.message}`));
        process.exit(1);
    }
}

startBot();
