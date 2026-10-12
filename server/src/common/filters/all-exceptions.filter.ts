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

/** 全局异常过滤器：统一错误响应为 { code, data, message }，code 取 HTTP 状态码 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    /** 业务异常自带的**结构化细节**（如并发冲突的 currentVersion / updatedBy）——透传到 data */
    let details: Record<string, unknown> | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const {
          message: msg,
          statusCode: _statusCode,
          error: _error,
          ...rest
        } = body as ErrorResponseBody & Record<string, unknown>;
        message = Array.isArray(msg) ? msg.join('; ') : (msg ?? exception.message);
        if (Object.keys(rest).length) details = rest;
      }
    } else {
      this.logger.error(
        `${request.method} ${request.url} 未捕获异常`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      code: status,
      data: details,
      message,
    });
  }
}
