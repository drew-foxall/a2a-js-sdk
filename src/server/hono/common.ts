import type { Context } from 'hono';
import { UnauthenticatedUser, User } from '../authentication/user.js';

export type UserBuilder = (c: Context) => Promise<User>;

export const UserBuilder = {
  noAuthentication: () => Promise.resolve(new UnauthenticatedUser()),
};
