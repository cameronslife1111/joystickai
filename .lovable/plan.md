OrB capabilities
As of September 4, 2026

Intent Routing
What Orby can do: Read a chat message and decide whether to answer in conversation, look something up on the web, or carry out real work in the workspace.
How Orby does it: Orby classifies each new message against the capabilities enabled for that chat, and in normal chat mode it stays inside the capabilities the user checked.

Multi-Step Planning
What Orby can do: Turn a goal into an ordered list of concrete steps that create, change, or generate things in the user's workspace.
How Orby does it: Orby composes a numbered step list from the request plus a snapshot of the user's documents and media, then executes the steps one at a time in order.

Plan Approval
What Orby can do: Show a proposed plan in the chat for review before anything runs.
How Orby does it: Orby posts a review card listing the steps; the user approves or declines, and a per-chat "Auto approve plans" setting can let approved plans start on their own.

Delegated Planning
What Orby can do: Take a loose request or a highlighted piece of a document and decide on its own what work is needed, then start it.
How Orby does it: In Delegate mode Orby may switch on additional capabilities it needs (it never removes ones the user asked for), proposes the resulting plan, and requires an approval before running.

Step Sequencing and Data Piping
What Orby can do: Use the result of an earlier step as the input to a later one, such as feeding a document's text into an image prompt.
How Orby does it: Steps reference earlier results with templates, so ids, titles, and text flow forward through the plan.

Context Retention Across Steps
What Orby can do: Keep track of what has already been done inside a plan and across a conversation's earlier plans.
How Orby does it: Orby carries per-step reasoning plus a memory digest of previous plans in the same conversation into each new decision.

Runtime Plan Expansion
What Orby can do: Add extra steps while a plan is running, for "do this for every item" work where the number of items is unknown up front.
How Orby does it: A dedicated expansion step reads the material produced earlier and writes a fresh batch of real steps that are inserted into the running plan.

Plan Monitoring
What Orby can do: Show every plan's live status, step progress, per-step reasoning, and final summary.
How Orby does it: The AI Plans screen lists active and past plans with statuses (proposed, composing, running, awaiting media, retrying, done, failed, cancelled) and a badge for plans needing attention.

Plan Steering
What Orby can do: Accept a mid-run instruction that adjusts how the remaining steps behave.
How Orby does it: The user sends a steer note from the plan card, and Orby applies it to the steps still to come.

Stopping a Plan
What Orby can do: Cancel a plan that is running.
How Orby does it: Orby marks the plan cancelled so no further steps are attempted.

Fix and Retry
What Orby can do: Restart a failed plan from a couple of steps before the failure, optionally with a correction note.
How Orby does it: Orby rewinds the step pointer, applies the user's note, and continues in the background so the user can leave the screen.

Clarifying Questions
What Orby can do: Pause a plan to ask the user something it needs before continuing.
How Orby does it: A question step posts into the chat and the plan waits for the answer.

Background Execution
What Orby can do: Keep plans and chat replies progressing while the user does something else or closes the chat.
How Orby does it: Work continues on the server and finished replies are marked unread; replies are read aloud only once the user opens that conversation.

Document Creation
What Orby can do: Create new documents, including from a chat reply.
How Orby does it: Orby creates the document, adds any generated text, and links it in chat as a tappable document link.

Document Renaming and Deletion
What Orby can do: Rename a document, or mark one for deletion.
How Orby does it: Orby locates the document by fuzzy title match or from the workspace snapshot, then renames it or flags it for the user to confirm removal.

Sentence-Level Writing
What Orby can do: Add lines to the top or bottom of a document.
How Orby does it: Each line is stored as its own sentence row in the chosen document.

Rewriting and Editing
What Orby can do: Rewrite an existing line for clarity, tone, length, grammar, or style.
How Orby does it: Orby identifies the exact line by fuzzy content match and replaces its text.

Reorganizing Content
What Orby can do: Move lines within a document or into a different document, top or bottom.
How Orby does it: Orby moves the stored line and renumbers the surrounding order.

Deleting and Marking Content
What Orby can do: Delete a line outright, or mark lines with a trash cue for the user to review first.
How Orby does it: Orby either removes the row or prefixes a visual delete cue so nothing is lost without review.

Cross-Document Linking
What Orby can do: Attach a document to a specific line so the user can jump straight to it.
How Orby does it: Orby stores the link on the line and the app shows a tappable pill.

Document Reading and Summarizing
What Orby can do: Read the full text of one or more documents and summarize, analyze, compare, or answer questions about them.
How Orby does it: Attached documents are inlined into the conversation as context, so this needs the documents to be attached or found by title.

Text Generation into Documents
What Orby can do: Draft, continue, expand, shorten, or transform prose and place it at the top, bottom, or after the current line.
How Orby does it: Orby generates plain-text sentences and inserts them at the chosen position in the target document.

Insert Reply into a Document
What Orby can do: Drop any chat reply straight into a document.
How Orby does it: The reply is split into sentences and inserted at the chosen destination.

Insert Document Text into a Message
What Orby can do: Pull a document's full text into the chat message box so the user can keep typing from there.
How Orby does it: The note button lets the user pick documents, and their text is spliced in at the cursor instead of being attached as a reference.

Document Title Insertion
What Orby can do: Insert selected document titles into the message box as quoted, comma-separated names.
How Orby does it: A picker in chat settings inserts the chosen titles at the cursor.

Fuzzy Finding
What Orby can do: Locate documents, individual lines, media, and schedules from loose descriptions rather than exact names.
How Orby does it: Tokenized, emoji-aware scoring matches titles, content, and the original generation prompt of media.

Import and Export
What Orby can do: Import a plain-text file as one or more documents, and export the current document as text or PDF or all documents as text.
How Orby does it: Import parses titled checklists into documents; export builds the file in the browser and downloads it.

Copy and Share Text
What Orby can do: Copy the current line or a whole document to the clipboard.
How Orby does it: Menu actions write the text to the system clipboard.

Scheduled Chat Messages
What Orby can do: Schedule a chat message to be sent to Orby later, with the same capabilities the user checked.
How Orby does it: The message, its attachments, and its capability settings are stored with a fire time and run in the thread when due.

Recurring Schedules
What Orby can do: Repeat scheduled work once, hourly, daily, weekly, monthly, or yearly, with intervals, chosen weekdays, month days, and calendar dates.
How Orby does it: Orby computes the next fire time from the recurrence settings in the user's own time zone.

Schedule Windows and Limits
What Orby can do: Set a start date, an end date, or a maximum number of runs for a schedule.
How Orby does it: Each run advances the count and the schedule retires when a limit or end date is reached; there is a cap of 50 schedules per account.

Managing Schedules
What Orby can do: List, create, edit, pause or resume, and delete scheduled work, including from within a plan.
How Orby does it: Schedule tools and the schedules list both operate on the same stored settings, and next-run times are recalculated on every change.

Automatic Firing
What Orby can do: Run due schedules without the app being open.
How Orby does it: A background tick claims due schedules and runs them, with fairness caps per tick and per account.

Scheduled Plan Work
What Orby can do: Have scheduled requests turn into full plans, not just messages.
How Orby does it: A fired schedule runs the same turn logic as a live chat, so an actionable request becomes a plan and executes.

Web Search
What Orby can do: Answer questions that need current, real-world information with a synthesized plain-text answer.
How Orby does it: Orby searches the web through a connected search service and writes the answer without citation markers; this requires that integration to be configured.

Conversation-Aware Search
What Orby can do: Understand short follow-ups like "what about prices for that one?" when searching.
How Orby does it: Orby rewrites the follow-up into a standalone question using the recent thread transcript, and passes the transcript along as context.

Research into Documents
What Orby can do: Run a search and place the findings directly into a document.
How Orby does it: The search answer is split into sentences and inserted at the chosen position.

Image Analysis
What Orby can do: Look at one or more attached images and describe, interpret, or answer questions about them.
How Orby does it: Images are sent with the message to a vision-capable model; up to six images can ride along with one message.

Image Analysis into Documents
What Orby can do: Turn what it sees in an image into text placed in a document.
How Orby does it: The description is generated with any attached documents as context and inserted at the chosen position.

Image Generation
What Orby can do: Create images from a written prompt, with selectable aspect ratio and quality.
How Orby does it: Generation runs as a background job through the connected image service and the finished image lands in the media gallery.

Prompt Assembly from Documents
What Orby can do: Build an image prompt from typed text plus the full contents of chosen documents.
How Orby does it: The typed text comes first, then each attached document's text, before the prompt is sent.

Image Editing and Regeneration
What Orby can do: Edit an existing image with new instructions, or regenerate it from a revised prompt.
How Orby does it: The original image and the new instruction are sent to the connected editing service as a background job.

Image Remixing
What Orby can do: Combine several reference images into a new one.
How Orby does it: Orby passes the selected images plus a prompt to the image service.

Image to Video
What Orby can do: Animate a still image into a short video from a motion prompt.
How Orby does it: The job is queued with the connected video service and polled until the video is ready.

Video to Video
What Orby can do: Restyle or re-drive an existing video with new instructions.
How Orby does it: Orby submits the source video and prompt as a motion-control job to the video service.

Talking Avatar Video
What Orby can do: Turn an image plus audio into a lip-synced avatar video.
How Orby does it: The image and audio are submitted to the connected avatar service as a background job.

Media Job Tracking
What Orby can do: Show generating, failed, and finished media, retry failures, and stop a running generation.
How Orby does it: A background poller updates each job's status and the gallery reflects it live.

Voice-Guided Media Revision
What Orby can do: Rework a media prompt by voice or typing and regenerate from the revised version.
How Orby does it: Orby rewrites the stored prompt with the user's requested change; dictated notes are shown for review and never submitted automatically.

Media Library Management
What Orby can do: Upload, rename, organize into folders, multi-select, delete, and download media.
How Orby does it: Gallery actions manage stored assets, including bulk moves between folders and zip downloads of a selection.

Media Renaming by Orby
What Orby can do: Rename generated media as part of a plan.
How Orby does it: A rename step applies the new title to the asset it just created or found.

Inline Media in Chat
What Orby can do: Show images and videos it generated inside the conversation.
How Orby does it: Chat renders a gallery for the assets a plan produced.

Speech Output
What Orby can do: Read documents and chat replies aloud with a choice of voices and adjustable playback.
How Orby does it: Text is spoken through the connected text-to-speech service, pre-warmed and cached locally so playback starts immediately; replies are only read when their chat is open.

Voice Dictation
What Orby can do: Turn spoken input into text anywhere text is typed, including the chat box, the new-idea composer, and media dialogs.
How Orby does it: Recorded audio is transcribed server-side and appended at the cursor for review.

Hands-Free Voice Session
What Orby can do: Hold a spoken back-and-forth conversation about the user's documents.
How Orby does it: A live realtime voice session is opened with the user's document context loaded, and it can read documents, add text, edit or insert lines, mark lines for deletion, and rename documents by voice.

Chat Threads
What Orby can do: Keep separate conversations with their own history, titles, capabilities, and unread state.
How Orby does it: Threads are stored per account with auto-generated short titles, rename, clear, and delete, and each thread's context stays isolated.

Per-Chat Capability Control
What Orby can do: Let the user decide what Orby may do in a given chat: web search, image analysis, planning, image generation, video generation, document editing, and scheduling.
How Orby does it: Checkboxes gate the routes and tools available for that conversation, and they persist between visits.

Document Attachment
What Orby can do: Use whole documents as reference material in a conversation.
How Orby does it: Documents can be attached manually or auto-attached to new chats, and their full text is included as context.

Workspace Navigation
What Orby can do: Move through documents and lines quickly by gesture, jump distances, favorites, pins, recent documents, and search.
How Orby does it: A six-orb home cluster and a menu grid expose these actions, with a lock that freezes list cycling while editing.

Accounts and Sign-In
What Orby can do: Keep each user's documents, media, chats, plans, and schedules private to their account.
How Orby does it: Sign-in is handled by the app's authentication, including Google sign-in, and all stored data is scoped per user.

Appearance and Sound Settings
What Orby can do: Switch light and dark themes, set a photo background, choose voices, and mute audio.
How Orby does it: Preferences are saved per account and applied across the app.

Notifications
What Orby can do: Signal finished work, unread replies, and pending plans without interrupting.
How Orby does it: Brief emoji toasts plus unread and pending badges on the relevant buttons.
