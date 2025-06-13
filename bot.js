const TelegramBot = require('node-telegram-bot-api');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const express = require('express');
require('dotenv').config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

const app = express();
app.get('/', (_, res) => res.send('Бот работает!'));
app.listen(process.env.PORT || 3000);

let userStates = {};
let userPhotos = {};

// Авторизация к таблице
async function accessSheet() {
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  });
  await doc.loadInfo();
}

// Получить уникальные категории и подкатегории
async function getOptions(type, category = null) {
  await accessSheet();
  const sheet = doc.sheetsByIndex[0];
  const rows = await sheet.getRows();

  const categories = new Set();
  const subcategories = new Set();

  for (const row of rows) {
    if (row['категория']) categories.add(row['категория']);
    if (category && row['категория'] === category && row['подкатегория']) {
      subcategories.add(row['подкатегория']);
    }
  }

  return type === 'категория'
    ? Array.from(categories)
    : Array.from(subcategories);
}

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const photo = msg.photo[msg.photo.length - 1].file_id;
  userPhotos[chatId] = [photo];
  userStates[chatId] = { step: 'категория' };

  const categories = await getOptions('категория');
  const buttons = categories.map((c) => [{ text: c }]);

  bot.sendMessage(chatId, 'Выбери категорию:', {
    reply_markup: { keyboard: buttons, one_time_keyboard: true },
  });
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const state = userStates[chatId];

  if (!state || msg.text.startsWith('/')) return;

  const text = msg.text;

  if (state.step === 'категория') {
    state.category = text;
    state.step = 'подкатегория';

    const subcategories = await getOptions('подкатегория', text);
    const buttons = subcategories.map((s) => [{ text: s }]);

    bot.sendMessage(chatId, 'Теперь выбери подкатегорию:', {
      reply_markup: { keyboard: buttons, one_time_keyboard: true },
    });

  } else if (state.step === 'подкатегория') {
    state.subcategory = text;
    state.step = 'название';
    bot.sendMessage(chatId, 'Введите название товара:');

  } else if (state.step === 'название') {
    state.title = text;
    state.step = 'описание';
    bot.sendMessage(chatId, 'Введите описание товара (или "-" если нет):');

  } else if (state.step === 'описание') {
    state.description = text === '-' ? '' : text;
    state.step = 'цена';
    bot.sendMessage(chatId, 'Введите цену товара:');

  } else if (state.step === 'цена') {
    state.price = text;
    state.step = 'подтверждение';

    const photoId = userPhotos[chatId][0];
    bot.sendPhoto(chatId, photoId, {
      caption: `❗️Проверь:\n\n📦 *${state.title}*\n🧾 ${state.description}\n💰 ${state.price} ₽\n📁 ${state.category} > ${state.subcategory}`,
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '✅ Добавить' }, { text: '❌ Отменить' }]],
        one_time_keyboard: true,
      },
    });

  } else if (state.step === 'подтверждение') {
    if (text === '✅ Добавить') {
      await accessSheet();
      const sheet = doc.sheetsByIndex[0];
      const photo = await bot.getFile(userPhotos[chatId][0]);
      const photoUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${photo.file_path}`;

      await sheet.addRow({
        'категория': state.category,
        'подкатегория': state.subcategory,
        'название': state.title,
        'описание': state.description,
        'цена': state.price,
        'ссылка на фото': photoUrl,
      });

      bot.sendMessage(chatId, '✅ Товар добавлен в таблицу!');
    } else {
      bot.sendMessage(chatId, '❌ Добавление отменено.');
    }

    delete userStates[chatId];
    delete userPhotos[chatId];
  }
});