const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();

// Настройки из .env файла
const TOKEN = process.env.BOT_TOKEN;
const MEDIA_INTERVAL = parseInt(process.env.MEDIA_INTERVAL || "10800000", 10);
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
let isAddingToQueue = false; // Флаг блокировки для добавления в очередь

// Инициализация бота
const bot = new TelegramBot(TOKEN, { polling: true });

// Создаем клавиатуру Reply Keyboard
const mainKeyboard = {
  keyboard: [[{ text: "Посмотреть очередь 📋" }]],
  resize_keyboard: true, // Уменьшает размер клавиатуры
  one_time_keyboard: false, // Клавиатура будет постоянно видна
};

// Регистрация команд бота
bot.setMyCommands([
  { command: "queue", description: "Показать состояние очереди медиа файлов" },
  { command: "help", description: "Показать справку по боту" },
]);

// Обработка команды start для отображения клавиатуры
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(
    chatId,
    "Добро пожаловать! Используйте клавиатуру ниже для управления ботом или отправьте фото/видео для добавления в очередь.",
    {
      reply_markup: mainKeyboard,
    }
  );
});

// Обработка команд
bot.onText(/\/queue/, (msg) => {
  const chatId = msg.chat.id;
  showQueueStatus(chatId);
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
    (MEDIA_INTERVAL / 1000 / 60 / 60).toFixed(1) +
    " час(а)";

  bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
});

// Обработка входящих сообщений
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // Проверяем текст сообщения на совпадение с кнопкой
  if (msg.text === "Посмотреть очередь 📋") {
    // Вызываем функциональность команды /queue
    const message = await showQueueStatus(chatId);
    return;
  }

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
    bot.sendMessage(chatId, "Пожалуйста, отправьте фото или видео файл.", {
      reply_markup: mainKeyboard, // Добавляем клавиатуру к сообщению
    });
  }
});

// Функция обработки медиа файлов
async function handleMedia(chatId, fileId, mediaType, userCaption = "") {
  // Ожидаем завершения предыдущей операции добавления в очередь (если есть)
  while (isAddingToQueue) {
    await new Promise((resolve) => setTimeout(resolve, 100)); // Ждем 100мс и проверяем снова
  }

  // Устанавливаем флаг блокировки
  isAddingToQueue = true;

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

    // Актуальная позиция в очереди теперь точно корректна, так как мы используем блокировку
    const queuePosition = mediaQueue.length + 1;

    // Рассчитываем предполагаемое время отправки более точно
    let estimatedSendTimeMs = Date.now();

    // Если очередь не пуста и идет обработка, учитываем время до завершения обработки текущего файла
    if (isProcessing && mediaQueue.length > 0) {
      const currentProcessingFile = mediaQueue[0];
      const elapsedTime = Date.now() - currentProcessingFile.timestamp;
      const remainingTime = Math.max(0, MEDIA_INTERVAL - elapsedTime);

      // Добавляем оставшееся время обработки текущего файла
      estimatedSendTimeMs += remainingTime;

      // Добавляем время на обработку всех файлов перед нашим
      estimatedSendTimeMs += (queuePosition - 1) * MEDIA_INTERVAL;
    } else {
      // Если обработка не идет, просто рассчитываем по позиции
      estimatedSendTimeMs += queuePosition * MEDIA_INTERVAL;
    }

    const estimatedSendTime = new Date(estimatedSendTimeMs);

    // Не добавляем лишние 3 часа, так как время уже в нужном часовом поясе
    const moscowTime = estimatedSendTime;
    const timeString = moscowTime.toTimeString().split(" ")[0]; // Формат ЧЧ:ММ:СС
    const dateString = moscowTime.toLocaleDateString("ru-RU"); // Дата в российском формате

    // Выбираем эмодзи в зависимости от типа файла
    const mediaEmoji = mediaType === "photo" ? "🖼️" : "🎬";

    // Упрощенное сообщение без лишней информации
    let message = `${mediaEmoji} *${
      mediaType === "photo" ? "Фото" : "Видео"
    } успешно добавлено в очередь!*\n\n`;
    message += `🔢 Позиция в очереди: ${queuePosition}\n`;
    message += `🗓️ Предполагаемое время отправки: ${dateString} ${timeString}`;

    // Добавляем подпись пользователя, если она есть
    if (userCaption) {
      message += `\n📝 Подпись: "${userCaption}"`;
    }

    // Редактируем сообщение о загрузке вместо отправки нового
    const statusMsg = await bot.editMessageText(message, {
      chat_id: chatId,
      message_id: loadingMsg.message_id,
      parse_mode: "Markdown",
    });

    // Создаем объект с информацией о файле
    const mediaObject = {
      senderChatId: chatId,
      filePath,
      mediaType,
      timestamp, // Момент добавления в очередь
      fileName,
      fileSize: fileSizeInMB,
      userCaption,
      statusMessageId: statusMsg.message_id,
      queuePosition, // Сохраняем позицию для отладки
      estimatedSendTime, // Сохраняем расчетное время отправки
    };

    // Добавляем в очередь (теперь безопасно, так как мы используем блокировку)
    mediaQueue.push(mediaObject);

    console.log(
      `Добавлен файл в очередь: позиция ${queuePosition}, планируемое время отправки: ${dateString} ${timeString}, всего в очереди: ${mediaQueue.length}`
    );

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
  } finally {
    // Снимаем блокировку в любом случае (даже при ошибке)
    isAddingToQueue = false;
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
      // Короткое сообщение об успешной отправке
      const updatedMessage = `${mediaEmoji} *${
        media.mediaType === "photo" ? "Фото" : "Видео"
      } успешно отправлено!*`;

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

// Функция для отображения статуса очереди
async function showQueueStatus(chatId) {
  if (mediaQueue.length === 0) {
    bot.sendMessage(
      chatId,
      "🤷‍♂️ Очередь медиа файлов пуста. Отправьте фото или видео, чтобы добавить их в очередь!",
      {
        reply_markup: mainKeyboard, // Добавляем клавиатуру к сообщению
      }
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

  const lastFileSendTime = new Date(
    Date.now() + timeToSend * 1000 + (mediaQueue.length - 1) * MEDIA_INTERVAL
  );
  const lastFileTimeString = lastFileSendTime.toTimeString().split(" ")[0]; // Формат ЧЧ:ММ:СС
  const lastFileDateString = lastFileSendTime.toLocaleDateString("ru-RU"); // Дата в российском формате

  let message = `📋 Состояние очереди медиа файлов\n\n`;
  message += `📊 Всего в очереди: ${mediaQueue.length} файлов\n`;

  // Добавляем информацию о последнем файле, если он не совпадает с первым
  if (mediaQueue.length > 1) {
    message += `\n\n*Последний файл в очереди:*\n`;
    message += `🔢 Позиция: ${mediaQueue.length}\n`;
    message += `🕒 Время отправки: ${lastFileDateString} ${lastFileTimeString}`;
  }

  bot.sendMessage(chatId, message, {
    parse_mode: "Markdown",
    reply_markup: mainKeyboard, // Добавляем клавиатуру к сообщению
  });
}

console.log(`Бот запущен! Интервал отправки: ${MEDIA_INTERVAL}мс`);
if (TARGET_CHANNEL_ID) {
  console.log(`Файлы будут отправляться в канал: ${TARGET_CHANNEL_ID}`);
} else {
  console.log(
    "Файлы будут отправляться обратно отправителям (TARGET_CHANNEL_ID не указан)"
  );
}
