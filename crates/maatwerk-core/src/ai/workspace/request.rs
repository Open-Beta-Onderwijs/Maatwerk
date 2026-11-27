// SPDX-License-Identifier: AGPL-3.0-or-later

//! The request file the CLI reads (`.maatwerk/request.md`, ADR-0009 finding 1).

use super::*;

pub(super) fn starter_text(s: Starter) -> &'static str {
    match s {
        Starter::FixErrors => {
            "Fix the errors and warnings of the check so the opdracht compiles cleanly, changing as little as possible."
        }
        Starter::CompleteAnswers => {
            "Add the missing answers (antwoord) and points (punten) to the questions (vragen), as the check lists them."
        }
        Starter::Rewrite => {
            "Rewrite the opdracht for another level, as the teacher describes below; keep its structure where you can."
        }
        Starter::NewOpgave => "Add a new exercise (opgave) as the teacher describes below.",
    }
}

pub(super) fn request_text(
    provider: &Resolved,
    resumes: bool,
    input: &TurnInput,
    listed: &[Listed],
    baseline: &Baseline,
) -> String {
    let mut r = String::from(
        "# Request from Maatwerk\n\n\
         You help a Dutch secondary-school teacher with an *opdracht* (a remedial assignment written in Typst) in the app Maatwerk. \
         The files in this folder are the teacher's current version; earlier proposals of yours may or may not have been applied.\n\n\
         ## Rules\n\n\
         - Edit only `opdracht.typ`, and add or change files in `images/` if a figure is needed. Do not change `main.typ` or `lib.typ`: changes there are discarded.\n\
         - Work only inside this folder. Never put student names, grades or other personal data in the opdracht.\n",
    );
    if provider.builtin == Some(Builtin::Claude) {
        // Its permission rules allow exactly `Bash(.maatwerk/check *)`; on Windows it otherwise
        // tries PowerShell on `check.cmd` first and is denied (real-CLI check, step 32c).
        r.push_str(
            "- After editing, run the check with the Bash tool, exactly `.maatwerk/check` (also on Windows). It prints JSON: `\"ok\": true` means it compiles; fix the errors it lists. Run no other commands.\n",
        );
    } else if provider.runs_check {
        r.push_str(
            "- After editing, run the check `.maatwerk/check` (on Windows `.maatwerk\\check.cmd`). It prints JSON: `\"ok\": true` means it compiles; fix the errors it lists. Run no other commands.\n",
        );
    } else {
        r.push_str(
            "- Do not run commands. Maatwerk checks the result itself after you finish and tells you about remaining errors.\n",
        );
    }
    r.push_str(
        "- You may search the web.\n\
         - Reply to the teacher in Dutch, briefly: what you changed and what they should check. Write the opdracht's content in the language the opdracht already uses (Dutch unless it is clearly in another language).\n\
         - Do not ask questions back; make reasonable choices and mention them in your reply.\n",
    );
    if !baseline.placeholders.is_empty() {
        r.push_str(
            "- The images in `images/` are grey placeholders of the right size: the teacher did not share them. Do not replace them unless asked.\n",
        );
    }
    if !listed.is_empty() {
        r.push_str("\n## Context\n\n");
        for (path, what) in listed {
            r.push_str(&format!("- `{path}`: {what}\n"));
        }
    }
    if let Some(s) = input.starter {
        r.push_str(&format!("\n## Task\n\n{}\n", starter_text(s)));
    }
    if !resumes && !input.past.is_empty() {
        r.push_str("\n## Conversation so far\n\n");
        for m in &input.past {
            let who = if m.from_teacher { "Teacher" } else { "You" };
            r.push_str(&format!("**{who}:** {}\n\n", m.text.trim()));
        }
    }
    r.push_str("\n## The teacher's message\n\n");
    let message = input.message.trim();
    r.push_str(if message.is_empty() {
        "(no text: do the task above)"
    } else {
        message
    });
    r.push('\n');
    r
}
