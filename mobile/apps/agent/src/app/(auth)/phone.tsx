import { LoginScreen } from '@/features/auth/LoginScreen';

/** Agents sign in with phone + password (admin-provisioned; password is set on first
 *  access via a one-time SMS code — see the reset screen). This route keeps the name
 *  `phone` so the shared onboarding "Sign in" CTA (→ /(auth)/phone) lands here. */
export default LoginScreen;
