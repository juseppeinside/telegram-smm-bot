const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();

// Настройки из .env файла
const TOKEN = process.env.BOT_TOKEN;
const MEDIA_INTERVAL = parseInt(process.env.MEDIA_INTERVAL || "60000", 10);
const MEDIA_FOLDER = process.env.MEDIA_FOLDER || "./media";
const TARGET_CHANNEL_ID = process.env.TARGET_CHANNEL_ID || "";

// Проверка наличия токена
if (!TOKEN) {
  console.error("Ошибка: BOT_TOKEN не найден в .env файле");
  process.exit(1);
}

// Создаем директорию для сохранения медиа файлов, если её нет
fs.ensureDirSync(MEDIA_FOLDER);

// Очередь медиа файлов для отправки
const mediaQueue = [];
let isProcessing = false;

// Инициализация бота
const bot = new TelegramBot(TOKEN, { polling: true });

// Регистрация команд бота
bot.setMyCommands([
  { command: "queue", description: "Показать состояние очереди медиа файлов" },
  { command: "help", description: "Показать справку по боту" },
]);

// Обработка команд
bot.onText(/\/queue/, (msg) => {
  const chatId = msg.chat.id;

  if (mediaQueue.length === 0) {
    bot.sendMessage(chatId, "Очередь медиа файлов пуста.");
    return;
  }

  const nextFile = mediaQueue[0];
  const timeToSend = nextFile
    ? Math.max(
        0,
        (nextFile.timestamp + MEDIA_INTERVAL - Date.now()) / 1000
      ).toFixed(0)
    : 0;

  // Рассчитываем московское время для следующего файла
  const nextSendTime = new Date(Date.now() + timeToSend * 1000);
  const moscowTime = new Date(nextSendTime.getTime() + 3 * 60 * 60 * 1000);
  const timeString = moscowTime.toTimeString().split(" ")[0]; // Формат ЧЧ:ММ:СС
  const dateString = moscowTime.toLocaleDateString("ru-RU"); // Дата в российском формате

  let message = `В очереди находится ${mediaQueue.length} медиа файлов.\n`;

  if (isProcessing && nextFile) {
    message += `\nСледующий файл: ${path.basename(nextFile.filePath)}\n`;
    message += `Тип: ${nextFile.mediaType === "photo" ? "Фото" : "Видео"}\n`;
    message += `Отправка через: примерно ${timeToSend} сек.\n`;
    message += `Время отправки (МСК): ${dateString} ${timeString}`;
  }

  bot.sendMessage(chatId, message);
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage =
    "Бот для обработки и отправки медиа файлов.\n\n" +
    "Доступные команды:\n" +
    "/queue - Показать состояние очереди\n" +
    "/help - Показать это сообщение\n\n" +
    "Для использования просто отправьте фото или видео.";

  bot.sendMessage(chatId, helpMessage);
});

// Обработка входящих сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Пропускаем сообщения с командами
  if (msg.text && msg.text.startsWith("/")) {
    return;
  }

  // Обрабатываем фото
  if (msg.photo) {
    const photo = msg.photo[msg.photo.length - 1]; // Берем фото с максимальным разрешением
    await handleMedia(chatId, photo.file_id, "photo");
  }
  // Обрабатываем видео
  else if (msg.video) {
    await handleMedia(chatId, msg.video.file_id, "video");
  }
  // Обрабатываем другие типы сообщений (кроме команд)
  else if (!msg.text || !msg.text.startsWith("/")) {
    bot.sendMessage(chatId, "Пожалуйста, отправьте фото или видео файл.");
  }
});

// Функция обработки медиа файлов
async function handleMedia(chatId, fileId, mediaType) {
  try {
    // Получаем ссылку на файл
    const fileInfo = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${fileInfo.file_path}`;

    // Формируем имя файла
    const timestamp = Date.now();
    const extension =
      path.extname(fileInfo.file_path) ||
      (mediaType === "photo" ? ".jpg" : ".mp4");
    const fileName = `${mediaType}_${timestamp}${extension}`;
    const filePath = path.join(MEDIA_FOLDER, fileName);

    // Скачиваем файл
    await downloadFile(fileUrl, filePath);

    // Добавляем в очередь
    mediaQueue.push({
      senderChatId: chatId, // ID отправителя для уведомлений
      filePath,
      mediaType,
      timestamp,
    });

    const queuePosition = mediaQueue.length;

    // Рассчитываем предполагаемое время отправки (по московскому времени)
    const estimatedSendTime = new Date(
      Date.now() + queuePosition * MEDIA_INTERVAL
    );

    // Корректируем для московского времени (UTC+3)
    const moscowTime = new Date(
      estimatedSendTime.getTime() + 3 * 60 * 60 * 1000
    );
    const timeString = moscowTime.toTimeString().split(" ")[0]; // Формат ЧЧ:ММ:СС
    const dateString = moscowTime.toLocaleDateString("ru-RU"); // Дата в российском формате

    bot.sendMessage(
      chatId,
      `${
        mediaType === "photo" ? "Фото" : "Видео"
      } успешно добавлено в очередь. Позиция: ${queuePosition}\nПредполагаемое время отправки (МСК): ${dateString} ${timeString}`
    );

    // Запускаем обработку очереди, если она еще не запущена
    if (!isProcessing) {
      processMediaQueue();
    }
  } catch (error) {
    console.error("Ошибка при обработке медиа файла:", error);
    bot.sendMessage(
      chatId,
      "Произошла ошибка при обработке файла. Попробуйте еще раз."
    );
  }
}

// Функция для скачивания файла
async function downloadFile(url, filePath) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Ошибка при скачивании файла: ${response.statusText}`);
  }

  const fileStream = fs.createWriteStream(filePath);
  const buffer = await response.arrayBuffer();

  return new Promise((resolve, reject) => {
    fileStream.write(Buffer.from(buffer));
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
    fileStream.end();
  });
}

// Функция обработки очереди медиа файлов
async function processMediaQueue() {
  if (mediaQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const media = mediaQueue.shift();

  try {
    console.log(`Отправка файла: ${media.filePath}`);

    // Определяем, куда отправлять - в канал или обратно отправителю
    const targetChatId = TARGET_CHANNEL_ID || media.senderChatId;

    if (media.mediaType === "photo") {
      await bot.sendPhoto(targetChatId, media.filePath);
    } else if (media.mediaType === "video") {
      await bot.sendVideo(targetChatId, media.filePath);
    }

    // Если отправляем в канал, уведомляем отправителя об успешной отправке
    if (TARGET_CHANNEL_ID && TARGET_CHANNEL_ID !== media.senderChatId) {
      bot.sendMessage(
        media.senderChatId,
        `Ваш файл успешно отправлен в канал.`
      );
    }

    // Удаляем файл после отправки
    await fs.remove(media.filePath);
    console.log(`Файл успешно отправлен и удален: ${media.filePath}`);
  } catch (error) {
    console.error("Ошибка при отправке файла:", error);

    // Если ошибка связана с отправкой в канал
    if (
      error.message.includes("chat not found") ||
      error.message.includes("bot is not a member")
    ) {
      console.error(
        "Ошибка доступа к каналу. Проверьте ID канала и права бота."
      );

      // Уведомляем отправителя об ошибке с каналом
      if (media.senderChatId) {
        bot.sendMessage(
          media.senderChatId,
          "Ошибка при отправке в канал. Файл не отправлен."
        );
      }
    } else {
      // Для других ошибок возвращаем файл в начало очереди
      mediaQueue.unshift(media);
    }
  }

  // Планируем следующую отправку
  setTimeout(processMediaQueue, MEDIA_INTERVAL);
}

console.log(`Бот запущен! Интервал отправки: ${MEDIA_INTERVAL}мс`);
if (TARGET_CHANNEL_ID) {
  console.log(`Файлы будут отправляться в канал: ${TARGET_CHANNEL_ID}`);
} else {
  console.log(
    "Файлы будут отправляться обратно отправителям (TARGET_CHANNEL_ID не указан)"
  );
}
