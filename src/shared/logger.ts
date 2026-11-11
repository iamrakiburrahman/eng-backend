import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';
const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, printf } = format;

interface IMessageProps{
    level: string;
    message: string;
    label: string;
    timestamp: Date;
}


const workerId = process.env.INSTANCE_ID ?? process.env.NODE_APP_INSTANCE;
const workerTag = workerId !== undefined ? `[W${workerId}]` : '';

const myFormat = printf((info: any) => {
    const { level, message, label, timestamp } = info as IMessageProps;
    const splat = info[Symbol.for('splat')];
    const extraParts = Array.isArray(splat)
        ? splat
            .filter((s: any) => !(s instanceof Error) || !String(message).includes(s.message))
            .map((s: any) => {
                if (s instanceof Error) return s.message;
                if (typeof s === 'object' && s !== null) {
                    if (typeof s.message === 'string') return s.message;
                    try { return JSON.stringify(s); } catch { return String(s); }
                }
                return String(s);
            })
            .filter(Boolean)
        : [];
    const extra = extraParts.length > 0 ? ` ${extraParts.join(' ')}` : '';
    const date = new Date(timestamp);
    const hour = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();
    return `${date.toDateString()} ${hour}:${minutes}:${seconds} [${label}]${workerTag} ${level}: ${message}${extra}`;
});


const logger = createLogger({
    level: 'info',
    format: combine(label({ label: 'PROJECT_NAME' }), timestamp(), myFormat),
    transports: [
        new transports.Console(),
        new DailyRotateFile({
            filename: path.join(process.cwd(), 'winston','success','%DATE%-success.log'),
            datePattern: 'DD-MM-YYYY-HH',
            maxSize: '20m',
            maxFiles: '1d',
        })
    ]
});

const errorLogger = createLogger({
    level: 'error',
    format: combine(label({ label: 'PROJECT_NAME' }), timestamp(), myFormat),
    transports: [
        new transports.Console(),
        new DailyRotateFile({
            filename: path.join(
            process.cwd(),'winston','error','%DATE%-error.log'),
            datePattern: 'DD-MM-YYYY-HH',
            maxSize: '20m',
            maxFiles: '1d'
        })
    ]
});
export { errorLogger, logger };