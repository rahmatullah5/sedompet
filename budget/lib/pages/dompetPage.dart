// Sedompet: sign in, switch Dompet, create / join a Dompet, manage members
// and invite codes.

import 'package:budget/colors.dart';
import 'package:budget/functions.dart';
import 'package:budget/struct/dompetService.dart';
import 'package:budget/struct/sedompetConfig.dart';
import 'package:budget/widgets/button.dart';
import 'package:budget/widgets/framework/pageFramework.dart';
import 'package:budget/widgets/globalSnackbar.dart';
import 'package:budget/widgets/openPopup.dart';
import 'package:budget/widgets/openSnackbar.dart';
import 'package:budget/widgets/textInput.dart';
import 'package:budget/widgets/textWidgets.dart';
import 'package:flutter/material.dart';

Future<void> _runWithFeedback(
  Future<void> Function() action, {
  String? successTitle,
}) async {
  try {
    await action();
    if (successTitle != null) {
      openSnackbar(SnackbarMessage(title: successTitle));
    }
  } on DompetException catch (e) {
    openSnackbar(SnackbarMessage(
      title: "Something went wrong",
      description: e.message,
      icon: Icons.warning_rounded,
    ));
  } catch (e) {
    openSnackbar(SnackbarMessage(
      title: "Connection error",
      description: e.toString(),
      icon: Icons.warning_rounded,
    ));
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title, {this.subtitle});
  final String title;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsetsDirectional.only(
          start: 20, end: 20, top: 22, bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextFont(
            text: title,
            fontSize: 17,
            fontWeight: FontWeight.bold,
          ),
          if (subtitle != null)
            Padding(
              padding: const EdgeInsetsDirectional.only(top: 4),
              child: TextFont(
                text: subtitle!,
                fontSize: 14,
                maxLines: 5,
                textColor: getColor(context, "textLight"),
              ),
            ),
        ],
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// Main page
// -----------------------------------------------------------------------------

class DompetPage extends StatelessWidget {
  const DompetPage({super.key});

  @override
  Widget build(BuildContext context) {
    return PageFramework(
      title: "Dompet",
      dragDownToDismiss: true,
      listWidgets: [
        AnimatedBuilder(
          animation: dompetService,
          builder: (context, _) {
            if (!sedompetBackendConfigured || !dompetService.isAvailable) {
              return const _SectionHeader(
                "Shared Dompet is not set up",
                subtitle:
                    "This build has no Supabase backend configured. The app works offline on this device only. See SETUP.md to enable shared Dompets.",
              );
            }
            if (!dompetService.isSignedIn) return const _SignInSection();
            // Not const: must rebuild on every dompetService change.
            return _SignedInSection();
          },
        ),
        const SizedBox(height: 60),
      ],
    );
  }
}

// -----------------------------------------------------------------------------
// Sign in: email code (works for everyone) + Google
// -----------------------------------------------------------------------------

class _SignInSection extends StatefulWidget {
  const _SignInSection();

  @override
  State<_SignInSection> createState() => _SignInSectionState();
}

class _SignInSectionState extends State<_SignInSection> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _code = TextEditingController();
  bool _codeSent = false;
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    await _runWithFeedback(action);
    if (mounted) setState(() => _busy = false);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _SectionHeader(
          "One wallet for the whole family",
          subtitle:
              "Sign in to share accounts, budgets and transactions with your family or friends.",
        ),
        if (sedompetGoogleConfigured)
          Padding(
            padding: const EdgeInsetsDirectional.symmetric(
                horizontal: 18, vertical: 6),
            child: Button(
              label: "Continue with Google",
              icon: Icons.login_rounded,
              onTap: () => _run(dompetService.signInWithGoogle),
            ),
          ),
        const _SectionHeader("Or use your email",
            subtitle: "We'll send a 6-digit code. No password needed."),
        TextInput(
          labelText: "Email",
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          readOnly: _codeSent,
          onSubmitted: (_) {
            if (!_codeSent) _sendCode();
          },
        ),
        if (_codeSent) ...[
          const SizedBox(height: 10),
          TextInput(
            labelText: "6-digit code",
            controller: _code,
            keyboardType: TextInputType.number,
            autoFocus: true,
            onSubmitted: (_) => _verify(),
          ),
        ],
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(
              horizontal: 18, vertical: 12),
          child: Row(
            children: [
              if (_codeSent)
                Expanded(
                  child: Button(
                    label: "Change email",
                    color: Theme.of(context).colorScheme.secondaryContainer,
                    textColor:
                        Theme.of(context).colorScheme.onSecondaryContainer,
                    onTap: () => setState(() {
                      _codeSent = false;
                      _code.clear();
                    }),
                  ),
                ),
              if (_codeSent) const SizedBox(width: 10),
              Expanded(
                child: Button(
                  label: _busy
                      ? "Please wait..."
                      : (_codeSent ? "Sign in" : "Send code"),
                  onTap: _codeSent ? _verify : _sendCode,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _sendCode() => _run(() async {
        await dompetService.sendEmailCode(_email.text);
        if (mounted) setState(() => _codeSent = true);
        openSnackbar(SnackbarMessage(
          title: "Code sent",
          description: "Check ${_email.text.trim()} for your login code.",
        ));
      });

  void _verify() => _run(
      () => dompetService.verifyEmailCode(_email.text, _code.text));
}

// -----------------------------------------------------------------------------
// Signed in: account, Dompet list, create, join
// -----------------------------------------------------------------------------

class _SignedInSection extends StatefulWidget {
  const _SignedInSection();

  @override
  State<_SignedInSection> createState() => _SignedInSectionState();
}

class _SignedInSectionState extends State<_SignedInSection> {
  final TextEditingController _newName = TextEditingController();
  final TextEditingController _joinCode = TextEditingController();

  @override
  void dispose() {
    _newName.dispose();
    _joinCode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dompets = dompetService.dompets;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          contentPadding: const EdgeInsetsDirectional.symmetric(horizontal: 20),
          leading: const Icon(Icons.account_circle_rounded),
          title: TextFont(
            text: dompetService.currentUserEmail ?? "Signed in",
            fontSize: 15,
          ),
          trailing: TextButton(
            onPressed: () => openPopup(
              context,
              title: "Sign out?",
              description:
                  "Your data on this device stays. You can sign in again any time.",
              icon: Icons.logout_rounded,
              onSubmitLabel: "Sign out",
              onSubmit: () {
                popRoute(context);
                _runWithFeedback(dompetService.signOut);
              },
              onCancelLabel: "Cancel",
              onCancel: () => popRoute(context),
            ),
            child: const Text("Sign out"),
          ),
        ),
        _SectionHeader(
          "Your Dompets",
          subtitle: dompets.isEmpty
              ? (dompetService.isLoading
                  ? "Loading..."
                  : "You're not in a Dompet yet. Create one for your family, or join with an invite code.")
              : "Tap to switch. Everyone in a Dompet shares the same accounts and transactions.",
        ),
        for (final d in dompets)
          ListTile(
            contentPadding:
                const EdgeInsetsDirectional.symmetric(horizontal: 20),
            leading: Icon(
              d.id == dompetService.currentDompetId
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_unchecked_rounded,
              color: Theme.of(context).colorScheme.primary,
            ),
            title: TextFont(text: d.name, fontSize: 16),
            subtitle: TextFont(
              text: "${d.myRole.label} · ${d.currency}",
              fontSize: 13,
              textColor: getColor(context, "textLight"),
            ),
            onTap: () => dompetService.selectDompet(d.id),
            trailing: IconButton(
              tooltip: "Members & invites",
              icon: const Icon(Icons.group_rounded),
              onPressed: () => pushRoute(context, DompetDetailsPage(dompet: d)),
            ),
          ),
        const _SectionHeader("Create a Dompet",
            subtitle: "e.g. \"Keluarga\", \"Kos Bareng\" or \"Trip Bali\""),
        TextInput(
          labelText: "Dompet name",
          controller: _newName,
          onSubmitted: (_) => _create(),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(
              horizontal: 18, vertical: 10),
          child: Button(label: "Create", onTap: _create),
        ),
        const _SectionHeader("Join with a code",
            subtitle: "Ask a member of the Dompet for a 6-character invite code."),
        TextInput(
          labelText: "Invite code",
          controller: _joinCode,
          textCapitalization: TextCapitalization.characters,
          onSubmitted: (_) => _join(),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(
              horizontal: 18, vertical: 10),
          child: Button(label: "Join", onTap: _join),
        ),
      ],
    );
  }

  void _create() => _runWithFeedback(() async {
        final d = await dompetService.createDompet(_newName.text);
        _newName.clear();
        openSnackbar(SnackbarMessage(title: "Created ${d.name}"));
      });

  void _join() => _runWithFeedback(() async {
        final d = await dompetService.joinWithCode(_joinCode.text);
        _joinCode.clear();
        openSnackbar(SnackbarMessage(title: "Joined ${d?.name ?? "Dompet"}"));
      });
}

// -----------------------------------------------------------------------------
// Dompet details: members, roles, invites, leave
// -----------------------------------------------------------------------------

class DompetDetailsPage extends StatefulWidget {
  const DompetDetailsPage({required this.dompet, super.key});
  final Dompet dompet;

  @override
  State<DompetDetailsPage> createState() => _DompetDetailsPageState();
}

class _DompetDetailsPageState extends State<DompetDetailsPage> {
  List<DompetMember> _members = [];
  List<DompetInvite> _invites = [];
  bool _loaded = false;
  final TextEditingController _myName = TextEditingController();
  final TextEditingController _dompetName = TextEditingController();

  // Role may change while this page is open; read the live value.
  Dompet get _dompet {
    for (final d in dompetService.dompets) {
      if (d.id == widget.dompet.id) return d;
    }
    return widget.dompet;
  }

  String? get _myUserId => dompetService.currentUser?.id;

  @override
  void initState() {
    super.initState();
    _dompetName.text = widget.dompet.name;
    _load();
  }

  @override
  void dispose() {
    _myName.dispose();
    _dompetName.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    await _runWithFeedback(() async {
      final members = await dompetService.fetchMembers(widget.dompet.id);
      final invites = _dompet.myRole.canAdmin
          ? await dompetService.fetchActiveInvites(widget.dompet.id)
          : <DompetInvite>[];
      if (!mounted) return;
      setState(() {
        _members = members;
        _invites = invites;
        _loaded = true;
        for (final m in members) {
          if (m.userId == _myUserId && _myName.text.isEmpty) {
            _myName.text = m.displayName ?? "";
          }
        }
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final dompet = _dompet;
    final myRole = dompet.myRole;
    return PageFramework(
      title: dompet.name,
      dragDownToDismiss: true,
      listWidgets: [
        if (myRole.canAdmin) ...[
          const _SectionHeader("Dompet name"),
          TextInput(labelText: "Dompet name", controller: _dompetName),
          Padding(
            padding: const EdgeInsetsDirectional.symmetric(
                horizontal: 18, vertical: 10),
            child: Button(
              label: "Save name",
              onTap: () => _runWithFeedback(
                () => dompetService.renameDompet(dompet.id, _dompetName.text),
                successTitle: "Saved",
              ),
            ),
          ),
        ],
        const _SectionHeader("Your name in this Dompet",
            subtitle: "Shown to other members, e.g. \"Ayah\", \"Ibu\", \"Kakak\"."),
        TextInput(labelText: "Display name", controller: _myName),
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(
              horizontal: 18, vertical: 10),
          child: Button(
            label: "Save",
            onTap: () => _runWithFeedback(() async {
              await dompetService.setMyDisplayName(dompet.id, _myName.text);
              await _load();
            }, successTitle: "Saved"),
          ),
        ),
        _SectionHeader(
          "Members",
          subtitle: _loaded ? null : "Loading...",
        ),
        for (final m in _members) _memberTile(context, m, myRole),
        if (myRole.canAdmin) ..._inviteSection(context, myRole),
        const _SectionHeader("Leave"),
        Padding(
          padding: const EdgeInsetsDirectional.symmetric(horizontal: 18),
          child: Button(
            label: "Leave this Dompet",
            color: Theme.of(context).colorScheme.errorContainer,
            textColor: Theme.of(context).colorScheme.onErrorContainer,
            onTap: () => openPopup(
              context,
              title: "Leave ${dompet.name}?",
              description: _members.length <= 1
                  ? "You are the last member. Leaving will permanently delete this Dompet."
                  : "You will lose access to this Dompet's shared data.",
              icon: Icons.logout_rounded,
              onSubmitLabel: "Leave",
              onSubmit: () {
                popRoute(context);
                _runWithFeedback(() async {
                  await dompetService.leaveDompet(dompet.id);
                  if (mounted) popRoute(this.context);
                });
              },
              onCancelLabel: "Cancel",
              onCancel: () => popRoute(context),
            ),
          ),
        ),
        const SizedBox(height: 60),
      ],
    );
  }

  Widget _memberTile(BuildContext context, DompetMember m, DompetRole myRole) {
    final isMe = m.userId == _myUserId;
    final List<DompetRole> assignable = myRole.isOwner
        ? DompetRole.values
        : (myRole == DompetRole.admin &&
                (m.role == DompetRole.member || m.role == DompetRole.viewer))
            ? const [DompetRole.member, DompetRole.viewer]
            : const [];
    final canRemove = !isMe &&
        (myRole.isOwner ||
            (myRole == DompetRole.admin &&
                (m.role == DompetRole.member || m.role == DompetRole.viewer)));

    return ListTile(
      contentPadding: const EdgeInsetsDirectional.symmetric(horizontal: 20),
      leading: CircleAvatar(
        child: Text(m.name.characters.first.toUpperCase()),
      ),
      title: TextFont(text: isMe ? "${m.name} (you)" : m.name, fontSize: 16),
      subtitle: TextFont(
        text: m.role.label,
        fontSize: 13,
        textColor: getColor(context, "textLight"),
      ),
      trailing: (assignable.isEmpty && !canRemove)
          ? null
          : PopupMenuButton<String>(
              onSelected: (value) {
                if (value == "remove") {
                  _runWithFeedback(() async {
                    await dompetService.removeMember(m.dompetId, m.userId);
                    await _load();
                  }, successTitle: "Removed ${m.name}");
                } else {
                  _runWithFeedback(() async {
                    await dompetService.setMemberRole(
                        m.dompetId, m.userId, dompetRoleFromString(value));
                    await _load();
                  }, successTitle: "Updated ${m.name}");
                }
              },
              itemBuilder: (context) => [
                for (final r in assignable)
                  if (r != m.role)
                    PopupMenuItem(
                      value: r.name,
                      child: Text("Make ${r.label}"),
                    ),
                if (canRemove)
                  const PopupMenuItem(
                    value: "remove",
                    child: Text("Remove from Dompet"),
                  ),
              ],
            ),
    );
  }

  List<Widget> _inviteSection(BuildContext context, DompetRole myRole) {
    final roles = [
      if (myRole.isOwner) DompetRole.admin,
      DompetRole.member,
      DompetRole.viewer,
    ];
    return [
      const _SectionHeader(
        "Invite people",
        subtitle:
            "Codes work for 7 days and up to 10 people. Share them only with people you trust.",
      ),
      Padding(
        padding: const EdgeInsetsDirectional.symmetric(horizontal: 14),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final r in roles)
              ActionChip(
                avatar: const Icon(Icons.person_add_rounded, size: 18),
                label: Text("Invite as ${r.label}"),
                tooltip: r.description,
                onPressed: () => _runWithFeedback(() async {
                  final invite =
                      await dompetService.createInvite(_dompet.id, role: r);
                  await _load();
                  if (mounted) _shareInvite(invite);
                }),
              ),
          ],
        ),
      ),
      for (final invite in _invites)
        ListTile(
          contentPadding:
              const EdgeInsetsDirectional.symmetric(horizontal: 20),
          leading: const Icon(Icons.key_rounded),
          title: TextFont(
            text: invite.code,
            fontSize: 20,
            fontWeight: FontWeight.bold,
            letterSpacing: 3,
          ),
          subtitle: TextFont(
            text:
                "${invite.role.label} · ${invite.uses}/${invite.maxUses} used · expires ${_shortDate(invite.expiresAt)}",
            fontSize: 13,
            textColor: getColor(context, "textLight"),
          ),
          onTap: () => _shareInvite(invite),
          trailing: IconButton(
            tooltip: "Revoke",
            icon: const Icon(Icons.block_rounded),
            onPressed: () => _runWithFeedback(() async {
              await dompetService.revokeInvite(invite.code);
              await _load();
            }, successTitle: "Invite revoked"),
          ),
        ),
    ];
  }

  void _shareInvite(DompetInvite invite) {
    final text =
        "Join our Dompet \"${_dompet.name}\" on Sedompet.\nInvite code: ${invite.code}";
    shareToClipboard(text, context: context);
  }

  static String _shortDate(DateTime d) =>
      "${d.day.toString().padLeft(2, "0")}/${d.month.toString().padLeft(2, "0")}";
}
