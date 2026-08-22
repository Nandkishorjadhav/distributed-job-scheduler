import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { RegisterInput, LoginInput } from '@job-scheduler/shared';
import { UserRepository, getPool } from '@job-scheduler/backend-shared';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../middleware/authenticate';

const getUserRepository = () => new UserRepository(getPool());

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError(500, 'JWT secret not configured', 'SERVER_MISCONFIGURED');
  }
  return secret;
}

export async function register(
  req: Request<object, object, RegisterInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password, name } = req.body;
    const userRepo = getUserRepository();

    const existingUser = await userRepo.findByEmail(email);
    if (existingUser) {
      throw new AppError(409, 'User with this email already exists', 'USER_ALREADY_EXISTS');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await userRepo.create({ email, passwordHash, name });

    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: user.id, email: user.email },
      secret,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request<object, object, LoginInput>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { email, password } = req.body;
    const userRepo = getUserRepository();

    const userRecord = await userRepo.findByEmail(email);
    if (!userRecord) {
      throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    const isPasswordValid = await bcrypt.compare(password, userRecord.password_hash);
    if (!isPasswordValid) {
      throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    }

    await userRepo.updateLastLogin(userRecord.id);

    const secret = getJwtSecret();
    const token = jwt.sign(
      { id: userRecord.id, email: userRecord.email },
      secret,
      { expiresIn: '1d' }
    );

    const user = {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      isActive: userRecord.is_active,
      lastLoginAt: userRecord.last_login_at,
      createdAt: userRecord.created_at,
      updatedAt: userRecord.updated_at,
    };

    res.status(200).json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (err) {
    next(err);
  }
}

export function logout(_req: Request, res: Response): void {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
}

export async function getCurrentUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'Authentication required', 'UNAUTHORIZED');
    }

    const userRepo = getUserRepository();
    const user = await userRepo.findById(req.user.id);

    if (!user) {
      throw new AppError(404, 'User not found', 'USER_NOT_FOUND');
    }

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (err) {
    next(err);
  }
}
