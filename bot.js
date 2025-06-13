const TelegramBot = require("node-telegram-bot-api");
const { GoogleSpreadsheet } = require("google-spreadsheet");
const express = require("express");
const app = express();

const token = "8012750026:AAGQYD5LNdouGKHSoXChV7Qhx0BRheCQWds";
const bot = new TelegramBot(token, { polling: true });

// Подключение к Google таблице
const doc = new GoogleSpreadsheet("1VIey-N-LWWisbehPHWI3WxDqBsoxzWTkJIEJvVlbTK8");

const serviceEmail = process.env.GOOGLE_SERVICE_EMAIL;
const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

const userState = {};

async function loadSheet() {
  await doc.useServiceAccountAuth({
    client_email: serviceEmail,
    private_key: privateKey,
  });
  await doc.loadInfo();
  return doc.sheetsByIndex[0];
}

function resetUser(chatId) {
  userState[chatId] = {
    step: "start",
    photo: null,
    category: null,
    subcategory: null,
    name: null,
    description: null,
    price: null,
  };
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const state = userState[chatId] || { step: "start" };

  if (msg.photo) {
    resetUser(chatId);
    userState[chatId].photo = msg.photo[msg.photo.length - 1].file_id;

    const sheet = await loadSheet();
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    const uniqueCategories = [...new Set(rows.map(row => row["категория"]))];

    userState[chatId].step = "category";
    bot.sendMessage(chatId, "Выберите категорию:", {
      reply_markup: {
        keyboard: uniqueCategories.map(c => [c]),
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }

  if (state.step === "category") {
    userState[chatId].category = text;

    const sheet = await loadSheet();
    const rows = await sheet.getRows();
    const subcategories = [...new Set(
      rows
        .filter(r => r["категория"] === text)
        .map(r => r["подкатегория"])
    )];

    userState[chatId].step = "subcategory";
    bot.sendMessage(chatId, "Выберите подкатегорию:", {
      reply_markup: {
        keyboard: subcategories.map(s => [s]),
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return;
  }

  if (state.step === "subcategory") {
    userState[chatId].subcategory = text;
    userState[chatId].step = "name";
    bot.sendMessage(chatId, "Введите название товара:");
    return;
  }

  if (state.step === "name") {
    userState[chatId].name = text;
    userState[chatId].step = "description";
    bot.sendMessage(chatId, "Введите описание товара:");
    return;
  }

  if (state.step === "description") {
    userState[chatId].description = text;
    userState[chatId].step = "price";
    bot.sendMessage(chatId, "Введите цену товара:");
    return;
  }

  if (state.step === "price") {
    userState[chatId].price = text;

    const sheet = await loadSheet();
    await sheet.addRow({
      "категория": userState[chatId].category,
      "подкатегория": userState[chatId].subcategory,
      "название": userState[chatId].name,
      "описание": userState[chatId].description,
      "цена": userState[chatId].price,
      "ссылка на фото": `https://api.telegram.org/file/bot${token}/${await getFilePath(userState[chatId].photo)}`
    });

    bot.sendMessage(chatId, "✅ Товар добавлен в таблицу!");
    resetUser(chatId);
  }
});

// Получить прямую ссылку на фото
async function getFilePath(fileId) {
  const file = await bot.getFile(fileId);
  return file.file_path;
}

// Express-сервер для Render
app.get("/", (req, res) => {
  res.send("Бот работает!");
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});