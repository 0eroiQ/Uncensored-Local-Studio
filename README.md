# Uncensored AI Studio

<p align="center">
  <strong>A portable local AI studio for image generation, private LLM chat, whole-project coding, speech-to-text, and text-to-speech.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Local_Inference-100%25-green?style=for-the-badge" alt="100% Local Inference" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20macOS-blue?style=for-the-badge" alt="Platforms" />
  <img src="https://img.shields.io/badge/License-MIT-orange?style=for-the-badge" alt="License" />
</p>

> [!IMPORTANT]
> AI inference runs locally on your machine. Internet access is only needed for optional tasks such as downloading models, searching Hugging Face, or installing source updates from GitHub.

---

## Table of Contents

- [What is Uncensored AI Studio?](#what-is-uncensored-ai-studio)
- [Key Features](#key-features)
- [Work: Local Coding Agent](#work-local-coding-agent)
- [Local Coding Models](#local-coding-models)
- [Project Memory and Continuity](#project-memory-and-continuity)
- [Safety Model](#work-safety-model)
- [Updates](#in-app-updates)
- [Workspace Architecture](#workspace-architecture)
- [Supported Models](#supported-models)
- [Folder Architecture](#folder-architecture)
- [Getting Started](#getting-started)
- [Hardware Compatibility](#hardware-compatibility)
- [Troubleshooting](#troubleshooting)
- [Building From Source](#building-from-source)
- [License](#license)

---

## What is Uncensored AI Studio?

**Uncensored AI Studio** is a self-contained local AI environment for Windows, Linux, and macOS. It bundles portable runtimes and local backend engines so you can run AI workloads without sending prompts, project code, generated images, or speech content to a hosted inference API.

The application currently combines five major capabilities:

1. **Image Generation** — Stable Diffusion compatible local checkpoints through `stable-diffusion.cpp`.
2. **Text Chat** — Local GGUF chat/instruct models through `llama.cpp`.
3. **Work** — A local coding workspace and whole-project agent for real source folders.
4. **Speech-to-Text** — Local Whisper transcription through `whisper.cpp`.
5. **Text-to-Speech** — Local Kokoro TTS.

---

## Key Features

- **Local inference:** No cloud AI API key is required for image, text, speech, TTS, or Work inference.
- **Portable runtime:** Node.js, model folders, downloaded backends, generated outputs, chat history, and Work memory can stay inside the installation folder or on an external drive.
- **Hardware acceleration:** CUDA, ROCm, Vulkan, Metal, CPU fallback, and selected OpenVINO/CoreML paths depending on platform.
- **Integrated Model Manager:** Download supported models directly from known URLs or import local model files.
- **Persistent download progress:** Active model downloads can be monitored even if the model panel is closed and reopened.
- **Live telemetry:** CPU, RAM, GPU, and VRAM usage is shown in the UI where supported.
- **USB-friendly data layout:** Models, generated outputs, chat history, Work memory, backends, and local runtimes are excluded from normal source updates.
- **In-app updater:** Update the application source from GitHub `main`, rebuild the UI locally, restart, and roll back when a backup is available.

---

## Work: Local Coding Agent

**Work** is the local coding workspace inside Uncensored AI Studio.

Opening a project gives Work controlled access to that project folder. You do **not** need to manually select every source file before asking a coding question.

Typical flow:

```text
Open Project
    ↓
Project sandbox
    ↓
Local Qwen coding model
    ↓
search project
    ↓
read relevant files
    ↓
edit/create files
    ↓
inspect Git status / diff
    ↓
request test/build command
    ↓
user approves command
    ↓
inspect result
    ↓
repeat until finished
    ↓
save Work history + memory locally
```

### What Work can do

- Open a real project folder using the native folder picker.
- Browse the actual project tree.
- Open and manually edit text/code files.
- Search the whole selected project for symbols, filenames, and text.
- Read relevant source files automatically without requiring the user to open them first.
- Modify existing files with exact replacements.
- Create new files inside the selected project.
- Inspect Git branch, status, and diffs when the project is a Git repository.
- Request approved commands for tests, builds, linters, and other allowlisted developer tools.
- Maintain a persistent Work conversation for each project.
- Load project-specific memory from local storage.

### Whole-project behavior

Work does not dump an entire repository into the model context at once. Instead, it uses a bounded project scan plus agent tools.

The model can repeatedly request operations such as:

```text
search_project
read_file
replace_in_file
create_file
git_status
git_diff
run_command
finish
```

This lets a local model work across projects that are much larger than the model's immediate context window.

---

## Local Coding Models

Work includes dedicated local coding-model choices stored in `app/llm-models/`.

| Model | Quantization | Approx. size | Recommended memory | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Qwen2.5-Coder 14B Instruct** | Q4_K_M | ~8.99 GB | 16 GB+ | Recommended coding model for capable 16 GB systems. |
| **Qwen3 8B** | Q4_K_M | ~5 GB | 12 GB+ | Faster/lighter backup option. |
| **Qwen3-Coder 30B-A3B Instruct** | Q4_K_M | ~18.6 GB | 32 GB+ recommended | Larger coding model for higher-memory systems. |

The Work model picker detects system RAM and blocks obviously unsuitable loads where possible.

> [!NOTE]
> Downloading a model requires internet access. After the model has been downloaded, Work inference runs locally through the bundled `llama.cpp` server.

---

## Project Memory and Continuity

Local model weights do not automatically retrain themselves after each task. Work provides continuity using persistent local context instead.

For each project, Work can combine:

```text
Local coding model
      +
Current project files
      +
Previous Work conversation
      +
Project Memory
      ↓
Continue where the project left off
```

Work history and Project Memory are stored locally in the application's data folders. This allows the same project to recover prior decisions and context after the app is restarted.

Useful Project Memory examples:

- architecture decisions
- important commands
- coding conventions
- bugs already fixed
- files that matter to the project
- future tasks
- migration notes
- implementation constraints

Memory is scoped per project rather than shared blindly across unrelated projects.

---

## Work Safety Model

Work is designed around a selected-project sandbox.

Current protections include:

- Absolute paths outside the opened project are blocked.
- `../` path escapes are blocked.
- Symlink escapes outside the selected project are blocked.
- Whole-drive access is rejected.
- Binary files are not treated as editable source text.
- There is no autonomous delete-file tool in the current Work agent.
- Agent edits create local backup snapshots before modifying project files.
- Shell pipelines, redirects, command substitution, and multiline shell commands are blocked by the command runner.
- Commands must be from an allowlist of developer tools.
- Commands require explicit user approval before execution.
- The agent is instructed not to perform Git history rewriting, remote pushes, package publishing, or network installation actions as part of its normal loop.

Work is still software that can modify files. Keep normal source-control backups for important projects.

---

## In-App Updates

The app includes **Settings → Updates** for source updates from:

```text
0eroiQ/Uncensored-Local-Studio
branch: main
```

Normal update flow:

```text
Check for Updates
      ↓
Update Now
      ↓
download exact GitHub commit
      ↓
create rollback backup
      ↓
replace application source only
      ↓
rebuild frontend locally
      ↓
Restart Now
```

The updater preserves local user/runtime data such as model weights, generated outputs, chat history, downloaded backends, Work memory, and other ignored runtime folders.

If GitHub's commits API fails or returns an unexpected HTML response, the updater falls back to resolving the `main` branch SHA through Git where available. If neither verification method works, the UI reports that the update could not be verified instead of incorrectly saying the installation is current.

---

## Workspace Architecture

To avoid unnecessary RAM/VRAM pressure, heavyweight AI engines are managed by the local server and can be switched as needed.

- **Image Generation:** `stable-diffusion.cpp`, weights in `app/models/`.
- **Text Chat:** `llama.cpp`, GGUF weights in `app/llm-models/`.
- **Work:** reuses the local `llama.cpp` coding model and adds sandboxed project tools.
- **Speech:** `whisper.cpp`, models in `app/speech-models/`.
- **TTS:** Kokoro runtime/models under `app/tts-runtime/`, `app/tts-models/`, and `app/tts-cache/`.

On macOS Apple Silicon, local LLM inference uses the Metal-capable llama.cpp backend.

---

## Supported Models

### Image generation

| Model type | Supported | Folder | Notes |
| :--- | :--- | :--- | :--- |
| Stable Diffusion 1.5 checkpoints | Yes | `app/models/` | Best compatibility with `.safetensors` / `.ckpt`. |
| SDXL checkpoints | Yes | `app/models/` | Higher memory requirements. |
| Single-file SD/SDXL GGUF checkpoints | Limited | `app/models/` | Must be complete single-file checkpoints. |
| OpenVINO image model folders | Selected Intel NPU paths | `app/openvino-models/` | Requires matching OpenVINO setup. |
| CoreML image models | Selected Apple Silicon paths | `app/models/` | Requires the CoreML setup path. |
| Multi-component Flux/HiDream/Hunyuan/Wan/Qwen Image/Z-Image workflows | Not one-click | N/A | These generally require separate model components. |

### Text, Work, speech, and TTS

| Workspace | Model files | Folder | Notes |
| :--- | :--- | :--- | :--- |
| Text Chat | `.gguf` | `app/llm-models/` | llama.cpp-compatible chat/instruct models. |
| Work | `.gguf` | `app/llm-models/` | Coding/instruct GGUF models; dedicated Work picker included. |
| Speech-to-Text | whisper.cpp `.bin` | `app/speech-models/` | Local Whisper models. |
| Text-to-Speech | Kokoro manifests/assets | `app/tts-models/`, `app/tts-runtime/` | Local Kokoro setup. |

---

## Folder Architecture

```text
Uncensored-Local-Studio/
├── windows.bat
├── linux.sh
├── mac.sh
├── README.md
├── LICENSE
├── scripts/
│   ├── setup/
│   ├── reset/
│   ├── server/
│   │   ├── serve.cjs
│   │   ├── updater-preload.cjs
│   │   ├── work-preload.cjs
│   │   └── work-agent-preload.cjs
│   ├── workers/
│   ├── build/
│   └── config/
└── app/
    ├── frontend/              # React/Vite UI source
    ├── dist/                  # Locally built frontend
    ├── models/                # Image model weights
    ├── llm-models/            # Chat + Work GGUF models
    ├── speech-models/         # Whisper models
    ├── tts-models/            # TTS manifests/models
    ├── outputs/               # Generated images
    ├── chat-history/          # Text Chat + Work history/memory
    ├── work-backups/          # Backups created before Work agent edits
    ├── config/                # Local runtime/update/Work state
    ├── backend/               # Image backends
    ├── llm-backend/           # llama.cpp backends
    ├── speech-backend/        # whisper.cpp backends
    └── tools/                 # Portable Node.js and tools
```

Most runtime/data folders are excluded from Git source updates so local models and user data are not replaced by normal application updates.

---

## Getting Started

### Windows

1. Double-click `windows.bat`.
2. Let the first-run setup install the portable runtime/backends if required.
3. Open `http://localhost:1420`.
4. Download/import a model in Model Manager.

### Linux

```bash
chmod +x linux.sh
./linux.sh
```

Optional platform-specific setup paths may be available for CUDA, ROCm, Vulkan, CPU, or OpenVINO depending on hardware.

### macOS

```bash
chmod +x mac.sh
./mac.sh
```

The prebuilt macOS path is intended for Apple Silicon and uses Metal acceleration for supported local backends.

### Start Work

1. Open **Work** in the sidebar.
2. Click **Open Project** and choose a project folder.
3. Open the **Work Local AI** model picker.
4. Download or load a coding GGUF model.
5. Use **Whole Project Agent** for project-wide coding tasks.

Example prompt:

```text
Inspect this project, understand the architecture, find the cause of the login bug,
fix the relevant files, show me the diff, and run the appropriate tests.
```

When a command is requested, review it and choose **Approve once** or **Reject**.

---

## Hardware Compatibility

### Windows

| Hardware | Primary backends |
| :--- | :--- |
| NVIDIA | CUDA / Vulkan / CPU fallback |
| AMD Radeon | Vulkan / selected ROCm/HIP paths / CPU fallback |
| Intel GPU | Vulkan / selected SYCL paths / CPU fallback |

### Linux

| Hardware | Primary backends |
| :--- | :--- |
| NVIDIA | CUDA / Vulkan / CPU |
| AMD Radeon | ROCm / Vulkan / CPU |
| Intel GPU | Vulkan / SYCL / CPU |
| Intel Core Ultra NPU | Selected OpenVINO path |

### macOS

| Hardware | Primary backends |
| :--- | :--- |
| Apple Silicon | Metal / CPU fallback |

> [!NOTE]
> Model size matters as much as backend support. A model that exists on disk may still be too large to load comfortably on a low-memory system.

---

## Troubleshooting

<details>
  <summary><strong>Work shows no local coding model loaded</strong></summary>
  <p>Open the Work model picker, download/import a supported GGUF model, then choose <strong>Load for Work</strong>. The model is stored under <code>app/llm-models/</code>.</p>
</details>

<details>
  <summary><strong>A model is downloading but the model card looks idle</strong></summary>
  <p>The Work download monitor follows the server-side download state and can show percentage, downloaded/total size, speed, ETA, destination, and cancel. Make sure you are running the latest source update if that monitor is missing.</p>
</details>

<details>
  <summary><strong>Updates show unknown / cannot verify</strong></summary>
  <p>The updater tries the GitHub commits API and then a Git fallback. If neither works, check internet access, GitHub availability, DNS/proxy settings, and whether <code>git</code> is available on the host.</p>
</details>

<details>
  <summary><strong>Reset environment</strong></summary>
  <p>Run <code>scripts/reset/reset.ps1</code> on Windows or <code>scripts/reset/reset.sh</code> on Linux/macOS. Keep backups of important projects and user data before performing destructive maintenance.</p>
</details>

<details>
  <summary><strong>Linux backend reports GLIBC / GLIBCXX errors</strong></summary>
  <p>Prebuilt Linux binaries may require a newer distribution/runtime. Upgrade the OS or build the backend from source.</p>
</details>

<details>
  <summary><strong>Generation server crashed or is not responding</strong></summary>
  <p>Check the terminal used to launch the app. Typical causes include missing runtime libraries, unsupported backend/device combinations, invalid model formats, or insufficient RAM/VRAM.</p>
</details>

---

## Building From Source

The repository includes build/setup helpers under `scripts/build/` and `scripts/setup/`.

Typical requirements include:

- `git`
- `cmake`
- `make` or `ninja`
- a C++17 compiler
- appropriate SDK/runtime for CUDA, Vulkan, ROCm/HIP, Metal, or other selected backend

For example, a local `stable-diffusion.cpp` build can be configured with CMake for CPU, CUDA, Vulkan, ROCm, or Metal and then copied into the matching `app/backend/<platform>/<backend>/` folder expected by the launcher.

The text/Work engine uses `llama.cpp` compatible server binaries under `app/llm-backend/`.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).

Bundled/open-source backend components and downloaded model weights remain subject to their own licenses and distribution terms.
