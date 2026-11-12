// Build-time configuration for the Sedompet backend.
//
// Pass values with:
//   flutter run --dart-define-from-file=../sedompet.env.json
// (see sedompet.env.example.json in the repo root).
//
// When SUPABASE_URL / SUPABASE_ANON_KEY are missing the app still runs as a
// plain local-only budget app; Dompet features are hidden.

const String sedompetSupabaseUrl = String.fromEnvironment("SUPABASE_URL");
const String sedompetSupabaseAnonKey =
    String.fromEnvironment("SUPABASE_ANON_KEY");

// Google sign-in. The web client id is also used as `serverClientId` on
// Android/iOS so Supabase can verify the returned id token.
const String sedompetGoogleWebClientId =
    String.fromEnvironment("GOOGLE_WEB_CLIENT_ID");
const String sedompetGoogleIosClientId =
    String.fromEnvironment("GOOGLE_IOS_CLIENT_ID");

bool get sedompetBackendConfigured =>
    sedompetSupabaseUrl.isNotEmpty && sedompetSupabaseAnonKey.isNotEmpty;

bool get sedompetGoogleConfigured => sedompetGoogleWebClientId.isNotEmpty;
