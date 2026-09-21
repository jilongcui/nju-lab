import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

/** 统一成功响应格式：{ code: 0, data, message: 'ok' }；文件流（StreamableFile）原样放行 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) {
          return data as never;
        }
        return {
          code: 0,
          data: (data ?? null) as T,
          message: 'ok',
        };
      }),
    );
  }
}
