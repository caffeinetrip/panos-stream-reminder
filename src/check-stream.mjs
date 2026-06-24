import { readFile, writeFile } from 'node:fs/promises';

const CHANNEL_LOGIN = 'alexanderpanos';
const CHANNEL_URL = `https://www.twitch.tv/${CHANNEL_LOGIN}`;
const STATE_FILE = new URL('../state.json', import.meta.url);

const requiredEnvironment = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
];

for (const name of requiredEnvironment) {
  if (!process.env[name]) {
    throw new Error(`Required GitHub secret ${name} is not configured.`);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(payload)}`);
  }

  return payload;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function compact(value, limit) {
  const text = String(value ?? '').trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

async function getAppAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const payload = await requestJson('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  return payload.access_token;
}

async function getLiveStream(accessToken) {
  const url = new URL('https://api.twitch.tv/helix/streams');
  url.searchParams.set('user_login', CHANNEL_LOGIN);

  const payload = await requestJson(url, {
    headers: {
      'Client-ID': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return payload.data?.[0] ?? null;
}

async function sendTelegramMessage(stream) {
  const title = compact(stream.title || 'Без названия', 1_000);
  const game = compact(stream.game_name || 'Категория не указана', 250);
  const message = [
    '🔴 <b>Alexander Panos в эфире!</b>',
    '',
    `<b>Название:</b> ${escapeHtml(title)}`,
    `<b>Категория:</b> ${escapeHtml(game)}`,
    '',
    `<a href="${CHANNEL_URL}">Смотреть стрим на Twitch</a>`,
  ].join('\n');

  const endpoint = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const payload = await requestJson(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    }),
  });

  if (!payload.ok) {
    throw new Error(`Telegram rejected the message: ${JSON.stringify(payload)}`);
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { notifiedStreamId: null };
    throw error;
  }
}

async function main() {
  const state = await readState();
  const accessToken = await getAppAccessToken();
  const stream = await getLiveStream(accessToken);

  if (!stream) {
    if (state.notifiedStreamId !== null) {
      await writeFile(STATE_FILE, `${JSON.stringify({ notifiedStreamId: null }, null, 2)}\n`);
      console.log('Channel is offline. Notification state reset.');
    } else {
      console.log('Channel is offline.');
    }
    return;
  }

  if (state.notifiedStreamId === stream.id) {
    console.log(`Already notified for live stream ${stream.id}.`);
    return;
  }

  await sendTelegramMessage(stream);
  await writeFile(
    STATE_FILE,
    `${JSON.stringify({ notifiedStreamId: stream.id }, null, 2)}\n`,
  );
  console.log(`Telegram notification sent for live stream ${stream.id}.`);
}

await main();
