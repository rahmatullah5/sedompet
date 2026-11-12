// Sedompet: shared "Dompet" (household / group) client.
//
// Phase 1 scope: authentication, Dompet list, current Dompet selection,
// members and invite codes. All calls go straight to Supabase (PostgREST and
// the RPC functions in supabase/migrations). Finance data is not scoped by
// Dompet yet; that arrives with PowerSync in phase 2.

import 'dart:async';

import 'package:budget/struct/databaseGlobal.dart';
import 'package:budget/struct/sedompetConfig.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart' as gsi;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

enum DompetRole { owner, admin, member, viewer }

DompetRole dompetRoleFromString(String? value) {
  return DompetRole.values.firstWhere(
    (r) => r.name == value,
    orElse: () => DompetRole.viewer,
  );
}

extension DompetRolePermissions on DompetRole {
  bool get canWrite => this != DompetRole.viewer;
  bool get canAdmin => this == DompetRole.owner || this == DompetRole.admin;
  bool get isOwner => this == DompetRole.owner;

  String get label {
    switch (this) {
      case DompetRole.owner:
        return "Owner";
      case DompetRole.admin:
        return "Admin";
      case DompetRole.member:
        return "Member";
      case DompetRole.viewer:
        return "Viewer";
    }
  }

  String get description {
    switch (this) {
      case DompetRole.owner:
        return "Full control, can delete the Dompet";
      case DompetRole.admin:
        return "Manage members, categories and budgets";
      case DompetRole.member:
        return "Add and edit transactions";
      case DompetRole.viewer:
        return "Read only";
    }
  }
}

class Dompet {
  Dompet({
    required this.id,
    required this.name,
    required this.currency,
    required this.myRole,
    this.icon,
    this.colour,
    this.createdAt,
  });

  final String id;
  final String name;
  final String currency;
  final DompetRole myRole;
  final String? icon;
  final String? colour;
  final DateTime? createdAt;

  factory Dompet.fromRow(Map<String, dynamic> row, DompetRole myRole) {
    return Dompet(
      id: row["id"] as String,
      name: row["name"] as String,
      currency: (row["currency"] as String?) ?? "IDR",
      icon: row["icon"] as String?,
      colour: row["colour"] as String?,
      createdAt: DateTime.tryParse((row["created_at"] ?? "").toString()),
      myRole: myRole,
    );
  }
}

class DompetMember {
  DompetMember({
    required this.dompetId,
    required this.userId,
    required this.role,
    this.displayName,
    this.colour,
    this.joinedAt,
  });

  final String dompetId;
  final String userId;
  final DompetRole role;
  final String? displayName;
  final String? colour;
  final DateTime? joinedAt;

  String get name =>
      (displayName == null || displayName!.isEmpty) ? "Member" : displayName!;

  factory DompetMember.fromRow(Map<String, dynamic> row) {
    return DompetMember(
      dompetId: row["dompet_id"] as String,
      userId: row["user_id"] as String,
      role: dompetRoleFromString(row["role"] as String?),
      displayName: row["display_name"] as String?,
      colour: row["colour"] as String?,
      joinedAt: DateTime.tryParse((row["joined_at"] ?? "").toString()),
    );
  }
}

class DompetInvite {
  DompetInvite({
    required this.code,
    required this.dompetId,
    required this.role,
    required this.expiresAt,
    required this.maxUses,
    required this.uses,
    required this.revoked,
  });

  final String code;
  final String dompetId;
  final DompetRole role;
  final DateTime expiresAt;
  final int maxUses;
  final int uses;
  final bool revoked;

  bool get isUsable =>
      !revoked && uses < maxUses && expiresAt.isAfter(DateTime.now());

  factory DompetInvite.fromRow(Map<String, dynamic> row) {
    return DompetInvite(
      code: row["code"] as String,
      dompetId: row["dompet_id"] as String,
      role: dompetRoleFromString(row["role"] as String?),
      expiresAt: DateTime.parse(row["expires_at"].toString()).toLocal(),
      maxUses: (row["max_uses"] as num).toInt(),
      uses: (row["uses"] as num).toInt(),
      revoked: row["revoked"] == true,
    );
  }
}

/// Human-readable error raised by [DompetService].
class DompetException implements Exception {
  DompetException(this.message);
  final String message;
  @override
  String toString() => message;
}

const String _currentDompetPrefKey = "sedompetCurrentDompetId";

/// Global singleton. Listen to it (ChangeNotifier) to rebuild on auth,
/// Dompet list or current Dompet changes.
final DompetService dompetService = DompetService._();

class DompetService extends ChangeNotifier {
  DompetService._();

  bool _initialized = false;
  bool get isAvailable => _initialized;

  StreamSubscription<sb.AuthState>? _authSubscription;

  List<Dompet> _dompets = [];
  List<Dompet> get dompets => List.unmodifiable(_dompets);

  String? _currentDompetId;
  String? get currentDompetId => _currentDompetId;
  Dompet? get currentDompet {
    for (final d in _dompets) {
      if (d.id == _currentDompetId) return d;
    }
    return null;
  }

  bool _loading = false;
  bool get isLoading => _loading;

  sb.SupabaseClient get _client => sb.Supabase.instance.client;

  sb.User? get currentUser => _initialized ? _client.auth.currentUser : null;
  bool get isSignedIn => currentUser != null;
  String? get currentUserEmail => currentUser?.email;

  /// Call once at startup, after `sharedPreferences` is ready.
  /// Safe to call when the backend is not configured (no-op).
  Future<void> initialize() async {
    if (_initialized || !sedompetBackendConfigured) return;
    try {
      await sb.Supabase.initialize(
        url: sedompetSupabaseUrl,
        anonKey: sedompetSupabaseAnonKey,
      );
    } catch (e) {
      debugPrint("Sedompet: Supabase init failed: $e");
      return;
    }
    _initialized = true;
    _currentDompetId = sharedPreferences.getString(_currentDompetPrefKey);

    _authSubscription = _client.auth.onAuthStateChange.listen((state) {
      switch (state.event) {
        case sb.AuthChangeEvent.signedIn:
        case sb.AuthChangeEvent.initialSession:
        case sb.AuthChangeEvent.userUpdated:
          if (state.session != null) {
            unawaited(refresh());
          } else {
            notifyListeners();
          }
          break;
        case sb.AuthChangeEvent.signedOut:
          _dompets = [];
          unawaited(_setCurrentDompetId(null));
          break;
        default:
          break;
      }
    });
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /// Sends a 6-digit login code to [email]. Creates the account if needed.
  Future<void> sendEmailCode(String email) async {
    _requireAvailable();
    final cleaned = email.trim().toLowerCase();
    if (!RegExp(r"^[^@\s]+@[^@\s]+\.[^@\s]+$").hasMatch(cleaned)) {
      throw DompetException("Please enter a valid email address.");
    }
    await _guard(() => _client.auth.signInWithOtp(
          email: cleaned,
          shouldCreateUser: true,
        ));
  }

  Future<void> verifyEmailCode(String email, String code) async {
    _requireAvailable();
    await _guard(() => _client.auth.verifyOTP(
          type: sb.OtpType.email,
          email: email.trim().toLowerCase(),
          token: code.replaceAll(RegExp(r"\s"), ""),
        ));
  }

  /// Web: redirects to Google and back (the page reloads).
  /// Android/iOS: native Google account picker, then exchanges the id token.
  Future<void> signInWithGoogle() async {
    _requireAvailable();
    if (!sedompetGoogleConfigured) {
      throw DompetException("Google sign-in is not configured for this build.");
    }

    if (kIsWeb) {
      await _guard(() => _client.auth.signInWithOAuth(
            sb.OAuthProvider.google,
            redirectTo: Uri.base.origin,
          ));
      return;
    }

    final google = gsi.GoogleSignIn(
      clientId: defaultTargetPlatform == TargetPlatform.iOS &&
              sedompetGoogleIosClientId.isNotEmpty
          ? sedompetGoogleIosClientId
          : null,
      serverClientId: sedompetGoogleWebClientId,
      scopes: const ["email", "profile"],
    );
    final account = await google.signIn();
    if (account == null) return; // user cancelled
    final auth = await account.authentication;
    final idToken = auth.idToken;
    if (idToken == null) {
      throw DompetException("Google did not return an ID token.");
    }
    await _guard(() => _client.auth.signInWithIdToken(
          provider: sb.OAuthProvider.google,
          idToken: idToken,
          accessToken: auth.accessToken,
        ));
  }

  Future<void> signOut() async {
    if (!_initialized) return;
    await _guard(() => _client.auth.signOut());
  }

  // ---------------------------------------------------------------------------
  // Dompets
  // ---------------------------------------------------------------------------

  Future<void> refresh() async {
    if (!isSignedIn) return;
    _loading = true;
    notifyListeners();
    try {
      final uid = currentUser!.id;
      final List<dynamic> myRows = await _client
          .from("dompet_members")
          .select("dompet_id, role")
          .eq("user_id", uid);
      final roles = <String, DompetRole>{
        for (final r in myRows)
          r["dompet_id"] as String: dompetRoleFromString(r["role"] as String?)
      };

      final List<dynamic> dompetRows =
          await _client.from("dompets").select().order("created_at");
      _dompets = [
        for (final row in dompetRows)
          if (roles.containsKey(row["id"]))
            Dompet.fromRow(
                Map<String, dynamic>.from(row as Map), roles[row["id"]]!)
      ];

      if (currentDompet == null) {
        await _setCurrentDompetId(
            _dompets.isEmpty ? null : _dompets.first.id,
            notify: false);
      }
    } catch (e) {
      debugPrint("Sedompet: refresh failed: $e");
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> selectDompet(String dompetId) => _setCurrentDompetId(dompetId);

  Future<Dompet> createDompet(String name, {String currency = "IDR"}) async {
    _requireSignedIn();
    final trimmed = name.trim();
    if (trimmed.isEmpty) throw DompetException("Please enter a name.");
    final row = await _guard(() => _client.rpc("create_dompet", params: {
          "p_name": trimmed,
          "p_currency": currency,
        }));
    final created = Map<String, dynamic>.from(row as Map);
    await refresh();
    await _setCurrentDompetId(created["id"] as String);
    // refresh() swallows network errors; fall back to the RPC result.
    return currentDompet ?? Dompet.fromRow(created, DompetRole.owner);
  }

  Future<void> renameDompet(String dompetId, String name) async {
    _requireSignedIn();
    final trimmed = name.trim();
    if (trimmed.isEmpty) throw DompetException("Please enter a name.");
    await _guard(() =>
        _client.from("dompets").update({"name": trimmed}).eq("id", dompetId));
    await refresh();
  }

  /// Joins a Dompet with an invite code and makes it the current one.
  Future<Dompet?> joinWithCode(String code) async {
    _requireSignedIn();
    final cleaned = code.toUpperCase().replaceAll(RegExp(r"[^A-Z0-9]"), "");
    if (cleaned.length != 6) {
      throw DompetException("Invite codes are 6 characters long.");
    }
    final id = await _guard(() =>
        _client.rpc("redeem_dompet_invite", params: {"p_code": cleaned}));
    await refresh();
    await _setCurrentDompetId(id as String);
    return currentDompet;
  }

  Future<void> leaveDompet(String dompetId) async {
    _requireSignedIn();
    await _guard(
        () => _client.rpc("leave_dompet", params: {"p_dompet_id": dompetId}));
    if (_currentDompetId == dompetId) {
      await _setCurrentDompetId(null, notify: false);
    }
    await refresh();
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  Future<List<DompetMember>> fetchMembers(String dompetId) async {
    _requireSignedIn();
    final List<dynamic> rows = await _guard(() => _client
        .from("dompet_members")
        .select()
        .eq("dompet_id", dompetId)
        .order("joined_at"));
    return [
      for (final r in rows)
        DompetMember.fromRow(Map<String, dynamic>.from(r as Map))
    ];
  }

  Future<void> setMyDisplayName(String dompetId, String displayName) async {
    _requireSignedIn();
    final trimmed = displayName.trim();
    if (trimmed.isEmpty) throw DompetException("Please enter a name.");
    await _guard(() => _client
        .from("dompet_members")
        .update({"display_name": trimmed})
        .eq("dompet_id", dompetId)
        .eq("user_id", currentUser!.id));
  }

  Future<void> setMemberRole(
      String dompetId, String userId, DompetRole role) async {
    _requireSignedIn();
    await _guard(() => _client.rpc("set_dompet_member_role", params: {
          "p_dompet_id": dompetId,
          "p_user_id": userId,
          "p_role": role.name,
        }));
    if (userId == currentUser!.id) await refresh();
  }

  Future<void> removeMember(String dompetId, String userId) async {
    _requireSignedIn();
    await _guard(() => _client.rpc("remove_dompet_member", params: {
          "p_dompet_id": dompetId,
          "p_user_id": userId,
        }));
  }

  // ---------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------

  Future<DompetInvite> createInvite(
    String dompetId, {
    DompetRole role = DompetRole.member,
    int maxUses = 10,
    int validDays = 7,
  }) async {
    _requireSignedIn();
    final row = await _guard(() => _client.rpc("create_dompet_invite", params: {
          "p_dompet_id": dompetId,
          "p_role": role.name,
          "p_max_uses": maxUses,
          "p_valid_days": validDays,
        }));
    return DompetInvite.fromRow(Map<String, dynamic>.from(row as Map));
  }

  Future<List<DompetInvite>> fetchActiveInvites(String dompetId) async {
    _requireSignedIn();
    final List<dynamic> rows = await _guard(() => _client
        .from("dompet_invites")
        .select()
        .eq("dompet_id", dompetId)
        .eq("revoked", false)
        .gt("expires_at", DateTime.now().toUtc().toIso8601String())
        .order("created_at", ascending: false));
    return [
      for (final r in rows)
        DompetInvite.fromRow(Map<String, dynamic>.from(r as Map))
    ].where((i) => i.isUsable).toList();
  }

  Future<void> revokeInvite(String code) async {
    _requireSignedIn();
    await _guard(() => _client
        .from("dompet_invites")
        .update({"revoked": true}).eq("code", code));
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  Future<void> _setCurrentDompetId(String? id, {bool notify = true}) async {
    _currentDompetId = id;
    if (id == null) {
      await sharedPreferences.remove(_currentDompetPrefKey);
    } else {
      await sharedPreferences.setString(_currentDompetPrefKey, id);
    }
    if (notify) notifyListeners();
  }

  void _requireAvailable() {
    if (!_initialized) {
      throw DompetException(
          "Sedompet sync is not configured for this build (missing SUPABASE_URL).");
    }
  }

  void _requireSignedIn() {
    _requireAvailable();
    if (!isSignedIn) throw DompetException("Please sign in first.");
  }

  /// Runs a Supabase call and converts backend errors to [DompetException].
  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on sb.PostgrestException catch (e) {
      throw DompetException(_friendlyError(e.message));
    } on sb.AuthException catch (e) {
      throw DompetException(e.message);
    }
  }

  static String _friendlyError(String raw) {
    const messages = {
      "invalid_invite": "That invite code is invalid, expired or already used.",
      "forbidden": "You don't have permission to do that in this Dompet.",
      "last_owner":
          "A Dompet needs at least one owner. Make someone else owner first.",
      "cannot_invite_owner": "Owners can't be invited directly.",
      "only_owner_can_invite_admin": "Only owners can invite admins.",
      "use_leave_dompet": "Use \"Leave Dompet\" to remove yourself.",
      "not_a_member": "That person is no longer a member.",
      "not_authenticated": "Please sign in first.",
    };
    for (final entry in messages.entries) {
      if (raw.contains(entry.key)) return entry.value;
    }
    return raw;
  }
}
