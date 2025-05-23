# Telegram SMM Bot

Бот для обработки и отправки медиа файлов (фото и видео) в Telegram.

## Функциональность

- Прием медиа файлов (фото и видео) от пользователей
- Сохранение медиа файлов в файловую систему
- Очередь отправки медиа файлов с настраиваемым интервалом (по умолчанию 1 минута)
- Отправка файлов в указанный канал или чат
- Команды для проверки состояния очереди и получения справки

## Команды бота

- `/queue` - Показать текущее состояние очереди медиа файлов
- `/help` - Показать справку по использованию бота

## Установка и запуск

1. Клонировать репозиторий:

```
git clone https://github.com/yourusername/telegram-smm-bot.git
cd telegram-smm-bot
```

2. Установить зависимости:

```
npm install
```

3. Создать файл `.env` по образцу `.env.example` и указать свой токен бота:

```
cp .env.example .env
```

4. Отредактировать файл `.env` и внести свои данные:

```
BOT_TOKEN=your_bot_token_here
MEDIA_INTERVAL=3600000
MEDIA_FOLDER=./media
TARGET_CHANNEL_ID=-1001234567890
```

5. Запустить бота:

```
npm start
```

Для разработки можно использовать команду:

```
npm run dev
```

## Настройки окружения

- `BOT_TOKEN` - токен Telegram бота, полученный у [@BotFather](https://t.me/BotFather)
- `MEDIA_INTERVAL` - интервал отправки медиа файлов в миллисекундах (по умолчанию 3600000 = 1 час)
- `MEDIA_FOLDER` - путь для сохранения медиа файлов (по умолчанию ./media)
- `TARGET_CHANNEL_ID` - ID канала или чата, куда бот будет отправлять файлы из очереди. Если не указан, файлы будут отправляться обратно пользователям, которые их прислали.

### Получение ID канала

Чтобы получить ID канала:

1. Добавьте бота в канал как администратора
2. Отправьте сообщение в канал
3. Получите обновления через API: `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates`
4. Найдите поле `chat.id` в ответе - это и будет ID канала (обычно отрицательное число с 13-14 цифрами, например: `-1001234567890`)
