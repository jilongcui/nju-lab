import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  message?: string | string[];
}

/** 全局异常过滤器：统一错误响应为 { code, data: null, message }，code 取 HTTP 状态码 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const msg = (body as ErrorResponseBody).message;
        message = Array.isArray(msg) ? msg.join('; ') : (msg ?? exception.message);
      }
    } else {
      this.logger.error(
        `${request.method} ${request.url} 未捕获异常`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      code: status,
      data: null,
      message,
    });
  }
}
