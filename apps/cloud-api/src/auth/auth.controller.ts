import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { z } from 'zod';

import { parse } from '../common/validation.js';
import { AuthCtx, AuthedRequest, CurrentAuth, Public } from './auth-context.js';
import { AuthService } from './auth.service.js';

const LoginBody = z.object({
  tenant: z.string().trim().min(1, 'กรุณากรอกรหัสปั๊ม').max(40),
  username: z.string().trim().min(1, 'กรุณากรอกชื่อผู้ใช้').max(40),
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน').max(200),
});

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.auth.login(parse(LoginBody, body), req.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthCtx) {
    await this.auth.logout(auth);
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthCtx) {
    return this.auth.me(auth);
  }
}
