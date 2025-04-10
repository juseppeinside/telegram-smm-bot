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
    bot.sendMessage(
      chatId,
      "🤷‍♂️ Очередь медиа файлов пуста. Отправьте фото или видео, чтобы добавить их в очередь!"
    );
    return;
  }

  const nextFile = mediaQueue[0];
  const timeToSend = nextFile
    ? Math.max(
        0,
        (nextFile.timestamp + MEDIA_INTERVAL - Date.now()) / 1000
      ).toFixed(0)
    : 0;

  // Рассчитываем московское время для следующего файла без дополнительного смещения
  const nextSendTime = new Date(Date.now() + timeToSend * 1000);
  // Не добавляем лишние 3 часа, так как время уже в нужном часовом поясе
  const moscowTime = nextSendTime;
  const timeString = moscowTime.toTimeString().split(" ")[0]; // Формат ЧЧ:ММ:СС
  const dateString = moscowTime.toLocaleDateString("ru-RU"); // Дата в российском формате

  // Эмодзи в зависимости от типа файла
  const mediaEmoji = nextFile && nextFile.mediaType === "photo" ? "🖼️" : "🎬";

  // Подсчет количества фото и видео в очереди
  const photoCount = mediaQueue.filter(
    (item) => item.mediaType === "photo"
  ).length;
  const videoCount = mediaQueue.filter(
    (item) => item.mediaType === "video"
  ).length;

  let message = `📋 *Состояние очереди медиа файлов*\n\n`;
  message += `📊 Всего в очереди: ${mediaQueue.length} файлов\n`;
  message += `🖼️ Фото: ${photoCount}\n`;
  message += `🎬 Видео: ${videoCount}\n`;

  if (isProcessing && nextFile) {
    const fileName = path.basename(nextFile.filePath);
    const fileSize = fs.statSync(nextFile.filePath).size;
    const fileSizeInMB = (fileSize / (1024 * 1024)).toFixed(2);

    message += `\n*Следующий файл:*\n`;
    message += `${mediaEmoji} Тип: ${
      nextFile.mediaType === "photo" ? "Фото" : "Видео"
    }\n`;
    message += `📄 Имя файла: \`${fileName}\`\n`;
    message += `📦 Размер: ${fileSizeInMB} МБ\n`;
    message += `⏱️ Отправка через: примерно ${timeToSend} сек.\n`;
    message += `🕒 Время отправки: ${dateString} ${timeString}`;

    if (TARGET_CHANNEL_ID) {
      message += `\n📢 Будет отправлено в канал`;
    }
  }

  bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
});

bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;

  const helpMessage =
    "🤖 *Бот для обработки и отправки медиа файлов*\n\n" +
    "*Доступные команды:*\n" +
    "📋 /queue - Показать состояние очереди\n" +
    "❓ /help - Показать это сообщение\n\n" +
    "📝 *Как использовать:*\n" +
    "1️⃣ Просто отправьте фото или видео боту\n" +
    "2️⃣ Файл будет добавлен в очередь\n" +
    "3️⃣ Бот отправит файл в канал по расписанию\n\n" +
    "⏱️ Интервал отправки: " +
    (MEDIA_INTERVAL / 3600000).toFixed(1) +
    " час(а)";

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
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
    await handleMedia(chatId, photo.file_id, "photo", msg.caption || "");
  }
  // Обрабатываем видео
  else if (msg.video) {
    await handleMedia(chatId, msg.video.file_id, "video", msg.caption || "");
  }
  // Обрабатываем другие типы сообщений (кроме команд)
  else if (!msg.text || !msg.text.startsWith("/")) {
    bot.sendMessage(chatId, "Пожалуйста, отправьте фото или видео файл.");
  }
});

// Функция обработки медиа файлов
async function handleMedia(chatId, fileId, mediaType, userCaption = "") {
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
    const loadingMsg = await bot.sendMessage(
      chatId,
      `⏳ Начинаю загрузку ${mediaType === "photo" ? "фото" : "видео"}...`
    );

    await downloadFile(fileUrl, filePath);

    // Получаем размер файла
    const fileSize = fs.statSync(filePath).size;
    const fileSizeInMB = (fileSize / (1024 * 1024)).toFixed(2);

    // Рассчитываем предполагаемое время отправки
    const queuePosition = mediaQueue.length + 1; // +1 так как файл еще не добавлен в очередь
    const estimatedSendTime = new Date(
      Date.now() + queuePosition * MEDIA_INTERVAL
    );

    // Не добавляем лишние 3 часа, так как время уже в нужном часовом поясе
    const moscowTime = estimatedSendTime;
    const timeString = moscowTime.toTimeString().split(" ")[0]; // Формат ЧЧ:ММ:СС
    const dateString = moscowTime.toLocaleDateString("ru-RU"); // Дата в российском формате

    // Выбираем эмодзи в зависимости от типа файла
    const mediaEmoji = mediaType === "photo" ? "🖼️" : "🎬";

    let message = `${mediaEmoji} *${
      mediaType === "photo" ? "Фото" : "Видео"
    } успешно добавлено в очередь!*\n\n`;
    message += `📄 Имя файла: \`${fileName}\`\n`;
    message += `📦 Размер файла: ${fileSizeInMB} МБ\n`;
    message += `🔢 Позиция в очереди: ${queuePosition}\n`;
    message += `🗓️ Предполагаемое время отправки (МСК): ${dateString} ${timeString}\n`;

    if (userCaption) {
      message += `📝 Подпись: "${userCaption}"\n`;
    }

    if (TARGET_CHANNEL_ID) {
      message += `📢 Будет отправлено в канал`;
    } else {
      message += `📲 Будет отправлено обратно вам`;
    }

    // Редактируем сообщение о загрузке вместо отправки нового
    const statusMsg = await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: "Markdown",
    });

    // Добавляем в очередь
    mediaQueue.push({
      senderChatId: chatId, // ID отправителя для уведомлений
      filePath,
      mediaType,
      timestamp,
      fileName,
      fileSize: fileSizeInMB,
      userCaption, // Сохраняем подпись пользователя
      statusMessageId: statusMsg.message_id, // Сохраняем ID сообщения для последующего обновления
    });

    // Запускаем обработку очереди, если она еще не запущена
    if (!isProcessing) {
      processMediaQueue();
    }
  } catch (error) {
    console.error("Ошибка при обработке медиа файла:", error);
    bot.sendMessage(
      chatId,
      "❌ Произошла ошибка при обработке файла. Попробуйте еще раз."
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

    // Выбираем эмодзи в зависимости от типа файла
    const mediaEmoji = media.mediaType === "photo" ? "🖼️" : "🎬";

    // Используем подпись пользователя, если она есть
    const caption = media.userCaption || "";

    // Отправляем файл с подписью
    if (media.mediaType === "photo") {
      await bot.sendPhoto(targetChatId, media.filePath, { caption });
    } else if (media.mediaType === "video") {
      await bot.sendVideo(targetChatId, media.filePath, { caption });
    }

    // Обновляем статусное сообщение, если есть ID сообщения
    if (media.statusMessageId) {
      const successMessage = `${mediaEmoji} *${
        media.mediaType === "photo" ? "Фото" : "Видео"
      } успешно отправлено!*\n\n`;

      const currentTime = new Date();
      // Не добавляем лишние 3 часа, так как время уже в нужном часовом поясе
      const moscowTime = currentTime;
      const timeString = moscowTime.toTimeString().split(" ")[0];
      const dateString = moscowTime.toLocaleDateString("ru-RU");

      let updatedMessage = successMessage;
      updatedMessage += `📄 Имя файла: \`${
        media.fileName || path.basename(media.filePath)
      }\`\n`;
      if (media.fileSize)
        updatedMessage += `📦 Размер файла: ${media.fileSize} МБ\n`;
      updatedMessage += `✅ Отправлено в ${
        TARGET_CHANNEL_ID ? "канал" : "личные сообщения"
      }\n`;
      updatedMessage += `🕒 Время отправки (МСК): ${dateString} ${timeString}`;

      try {
        await bot.editMessageText(updatedMessage, {
          chat_id: media.senderChatId,
          message_id: media.statusMessageId,
          parse_mode: "Markdown",
        });
      } catch (editError) {
        console.error("Ошибка при обновлении статусного сообщения:", editError);
      }
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

      // Обновляем статусное сообщение об ошибке, если есть ID сообщения
      if (media.statusMessageId) {
        try {
          await bot.editMessageText(
            "❌ *Ошибка при отправке в канал*\n\nФайл не отправлен. Возможно, бот не добавлен в канал или не имеет прав администратора.",
            {
              chat_id: media.senderChatId,
              message_id: media.statusMessageId,
              parse_mode: "Markdown",
            }
          );
        } catch (editError) {
          console.error(
            "Ошибка при обновлении статусного сообщения:",
            editError
          );

          // Если не удалось обновить сообщение, отправляем новое
          bot.sendMessage(
            media.senderChatId,
            "❌ Ошибка при отправке в канал. Файл не отправлен. Возможно, бот не добавлен в канал или не имеет прав администратора."
          );
        }
      } else {
        // Если нет ID сообщения, отправляем новое
        bot.sendMessage(
          media.senderChatId,
          "❌ Ошибка при отправке в канал. Файл не отправлен. Возможно, бот не добавлен в канал или не имеет прав администратора."
        );
      }
    } else {
      // Для других ошибок возвращаем файл в начало очереди
      mediaQueue.unshift(media);

      // Обновляем статусное сообщение о временной ошибке
      if (media.statusMessageId) {
        try {
          await bot.editMessageText(
            "⚠️ *Временная ошибка при отправке файла*\n\nБот автоматически повторит попытку отправки.",
            {
              chat_id: media.senderChatId,
              message_id: media.statusMessageId,
              parse_mode: "Markdown",
            }
          );
        } catch (editError) {
          console.error(
            "Ошибка при обновлении статусного сообщения:",
            editError
          );

          // Если не удалось обновить сообщение, отправляем новое
          bot.sendMessage(
            media.senderChatId,
            "⚠️ Временная ошибка при отправке файла. Бот автоматически повторит попытку отправки."
          );
        }
      } else {
        // Если нет ID сообщения, отправляем новое
        bot.sendMessage(
          media.senderChatId,
          "⚠️ Временная ошибка при отправке файла. Бот автоматически повторит попытку отправки."
        );
      }
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
