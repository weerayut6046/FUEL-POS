import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { User, UserRole } from '@fuel-pos/shared';
import { Database, fromBool, toBool } from '../db/index.js';

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  pin_hash: string;
  pin_salt: string;
  active: number;
}

const SESSION_HOURS = 16; // ครอบคลุมกะยาวหนึ่งกะ

/**
 * ระบบผู้ใช้งานแบบ PIN
 *
 * ใช้ scrypt ของ Node เอง (ไม่พึ่ง bcrypt ที่เป็น native module)
 * เพื่อให้ติดตั้งบน Windows ได้โดยไม่ต้องคอมไพล์อะไรเพิ่ม
 */
export class AuthService {
  constructor(private readonly db: Database) {}

  // -- แฮช PIN -------------------------------------------------------------

  private static hash(pin: string, salt: string): string {
    return scryptSync(pin, salt, 64).toString('hex');
  }

  private static verify(pin: string, salt: string, expected: string): boolean {
    const actual = Buffer.from(AuthService.hash(pin, salt), 'hex');
    const target = Buffer.from(expected, 'hex');
    // ความยาวต่างกันแปลว่าไม่ตรงอยู่แล้ว และ timingSafeEqual จะ throw ถ้าความยาวต่าง
    if (actual.length !== target.length) return false;
    return timingSafeEqual(actual, target);
  }

  // -- ผู้ใช้ ---------------------------------------------------------------

  createUser(input: {
    username: string;
    displayName: string;
    role: UserRole;
    pin: string;
  }): User {
    if (!/^\d{4,8}$/.test(input.pin)) {
      throw new Error('PIN ต้องเป็นตัวเลข 4-8 หลัก');
    }
    const salt = randomBytes(16).toString('hex');
    const result = this.db.run(
      `INSERT INTO users (username, display_name, role, pin_hash, pin_salt, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      input.username,
      input.displayName,
      input.role,
      AuthService.hash(input.pin, salt),
      salt,
    );
    return this.requireUser(result.lastInsertRowid);
  }

  changePin(userId: number, newPin: string): void {
    if (!/^\d{4,8}$/.test(newPin)) throw new Error('PIN ต้องเป็นตัวเลข 4-8 หลัก');
    const salt = randomBytes(16).toString('hex');
    this.db.run(
      'UPDATE users SET pin_hash = ?, pin_salt = ? WHERE id = ?',
      AuthService.hash(newPin, salt),
      salt,
      userId,
    );
    // บังคับให้ล็อกอินใหม่ทุกอุปกรณ์
    this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  setActive(userId: number, active: boolean): void {
    this.db.run('UPDATE users SET active = ? WHERE id = ?', fromBool(active), userId);
    if (!active) this.db.run('DELETE FROM sessions WHERE user_id = ?', userId);
  }

  listUsers(): User[] {
    return this.db
      .all<UserRow>('SELECT * FROM users ORDER BY role, display_name')
      .map(AuthService.toUser);
  }

  requireUser(id: number): User {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE id = ?', id);
    if (!row) throw new Error(`ไม่พบผู้ใช้ id ${id}`);
    return AuthService.toUser(row);
  }

  countUsers(): number {
    return this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM users')?.n ?? 0;
  }

  // -- เข้าสู่ระบบ ----------------------------------------------------------

  login(username: string, pin: string): { token: string; user: User } {
    const row = this.db.get<UserRow>('SELECT * FROM users WHERE username = ?', username);
    if (!row || !toBool(row.active)) {
      throw new Error('ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง');
    }
    if (!AuthService.verify(pin, row.pin_salt, row.pin_hash)) {
      throw new Error('ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง');
    }

    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
    this.db.run(
      'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      token,
      row.id,
      expires,
    );
    this.pruneSessions();
    return { token, user: AuthService.toUser(row) };
  }

  logout(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token = ?', token);
  }

  /** ตรวจ token — คืน null ถ้าไม่ถูกต้องหรือหมดอายุ */
  resolveToken(token: string | undefined): User | null {
    if (!token) return null;
    const row = this.db.get<UserRow & { expires_at: string }>(
      `SELECT u.*, s.expires_at FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
      token,
    );
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.run('DELETE FROM sessions WHERE token = ?', token);
      return null;
    }
    if (!toBool(row.active)) return null;
    return AuthService.toUser(row);
  }

  private pruneSessions(): void {
    this.db.run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  }

  private static toUser(row: UserRow): User {
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      active: toBool(row.active),
    };
  }
}

/** ลำดับสิทธิ์: ตัวเลขสูงกว่าทำได้ทุกอย่างที่ตัวเลขต่ำกว่าทำได้ */
const ROLE_RANK: Record<UserRole, number> = {
  attendant: 1,
  cashier: 2,
  manager: 3,
  admin: 4,
};

export function hasRole(user: User, minimum: UserRole): boolean {
  return ROLE_RANK[user.role] >= ROLE_RANK[minimum];
}
