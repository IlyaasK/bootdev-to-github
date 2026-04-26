package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var languageExt = map[string]string{
	"go":         ".go",
	"python":     ".py",
	"javascript": ".js",
	"typescript": ".ts",
	"sql":        ".sql",
	"bash":       ".sh",
	"shell":      ".sh",
	"git":        ".sh",
}

const defaultExt = ".txt"

type File struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type Payload struct {
	UserUUID       string `json:"userUUID"`
	LessonUUID     string `json:"lessonUUID"`
	CourseUUID     string `json:"courseUUID"`
	Code           string `json:"code"`
	Kind           string `json:"kind"`
	CourseTitle    string `json:"courseTitle"`
	ChapterTitle   string `json:"chapterTitle"`
	LessonTitle    string `json:"lessonTitle"`
	CourseLanguage string `json:"courseLanguage"`
	Source         string `json:"source"`
	CliLog         string `json:"cliLog"`
	Files          []File `json:"files"`
}

var nonAlphanumericRegex = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	lower := strings.ToLower(s)
	slug := nonAlphanumericRegex.ReplaceAllString(lower, "-")
	return strings.Trim(slug, "-")
}

func jsonError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"ok": "false", "error": msg})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	targetDir := os.Getenv("TARGET_DIR")
	if targetDir == "" {
		// Default to ../bootdev
		cwd, err := os.Getwd()
		if err != nil {
			log.Fatalf("failed to get cwd: %v", err)
		}
		targetDir = filepath.Join(filepath.Dir(filepath.Dir(cwd)), "bootdev")
	}

	// Ensure target dir exists
	if _, err := os.Stat(targetDir); os.IsNotExist(err) {
		log.Printf("Warning: target directory %s does not exist. It will be created.", targetDir)
	}

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "https://www.boot.dev")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if r.Method != "POST" {
			jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			jsonError(w, "bad request", http.StatusBadRequest)
			return
		}

		var payload Payload
		if err := json.Unmarshal(body, &payload); err != nil {
			jsonError(w, "bad json", http.StatusBadRequest)
			return
		}

		if payload.CourseTitle == "" || payload.ChapterTitle == "" || payload.LessonTitle == "" {
			jsonError(w, "missing required metadata fields", http.StatusBadRequest)
			return
		}

		var commitMsg string

		courseSlug := slugify(payload.CourseTitle)
		chapterSlug := slugify(payload.ChapterTitle)
		lessonSlug := slugify(payload.LessonTitle)

		if payload.Kind == "progress" {
			// Non-code lesson
			pathBase := filepath.Join(courseSlug, chapterSlug, lessonSlug+".md")
			filePath := filepath.Join(targetDir, pathBase)
			mdContent := fmt.Sprintf("# %s\n\ncompleted %s\n", payload.LessonTitle, time.Now().UTC().Format(time.RFC3339))
			commitMsg = fmt.Sprintf("progress(%s): %s", courseSlug, payload.LessonTitle)

			if err := writeFile(filePath, mdContent); err != nil {
				jsonError(w, fmt.Sprintf("fs error: %v", err), http.StatusInternalServerError)
				return
			}
		} else {
			if payload.Code == "" && len(payload.Files) == 0 {
				jsonError(w, "no code or files provided", http.StatusBadRequest)
				return
			}

			lang := strings.TrimSpace(strings.ToLower(payload.CourseLanguage))
			ext, ok := languageExt[lang]
			if !ok {
				ext = defaultExt
				if lang != "" {
					log.Printf("unmapped language: %s, using .txt", lang)
				}
			}

			if payload.Source == "cli" && len(payload.Files) > 0 {
				for _, f := range payload.Files {
					fPath := filepath.Join(targetDir, courseSlug, chapterSlug, lessonSlug, f.Path)
					if err := writeFile(fPath, f.Content); err != nil {
						jsonError(w, fmt.Sprintf("fs error on %s: %v", fPath, err), http.StatusInternalServerError)
						return
					}
				}

				if payload.CliLog != "" {
					timestamp := strings.ReplaceAll(strings.ReplaceAll(time.Now().UTC().Format(time.RFC3339), ":", "-"), ".", "-")
					logName := fmt.Sprintf("%s-%s.log", lessonSlug, timestamp)
					logPath := filepath.Join(targetDir, courseSlug, chapterSlug, ".cli-logs", logName)
					if err := writeFile(logPath, payload.CliLog); err != nil {
						jsonError(w, fmt.Sprintf("fs error on log: %v", err), http.StatusInternalServerError)
						return
					}
				}

				commitMsg = fmt.Sprintf("feat(%s): %s", courseSlug, payload.LessonTitle)
			} else {
				// Single file browser submission
				filePath := filepath.Join(targetDir, courseSlug, chapterSlug, lessonSlug+ext)
				commitMsg = fmt.Sprintf("feat(%s): %s", courseSlug, payload.LessonTitle)

				if err := writeFile(filePath, payload.Code); err != nil {
					jsonError(w, fmt.Sprintf("fs error: %v", err), http.StatusInternalServerError)
					return
				}
			}
		}

		if err := commitAndPush(targetDir, commitMsg); err != nil {
			log.Printf("Git error: %v", err)
			jsonError(w, fmt.Sprintf("git error: %v", err), http.StatusInternalServerError)
			return
		}

		response := map[string]interface{}{
			"ok":     true,
			"commit": commitMsg,
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(response)
	})

	addr := "127.0.0.1:" + port
	log.Printf("bootdev-to-github local daemon listening on http://%s", addr)
	log.Printf("Target directory: %s", targetDir)
	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func writeFile(path, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0644)
}

func commitAndPush(dir, msg string) error {
	log.Printf("Committing: %s", msg)

	// Check if it's a git repository
	if _, err := os.Stat(filepath.Join(dir, ".git")); os.IsNotExist(err) {
		// Initialize git if it doesn't exist
		cmd := exec.Command("git", "init")
		cmd.Dir = dir
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("git init failed: %v", err)
		}
	}

	// git add .
	addCmd := exec.Command("git", "add", ".")
	addCmd.Dir = dir
	if out, err := addCmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git add failed: %s", string(out))
	}

	// git commit -m msg
	commitCmd := exec.Command("git", "commit", "-m", msg)
	commitCmd.Dir = dir
	out, err := commitCmd.CombinedOutput(); 
	
	// If nothing to commit, that's fine
	if err != nil && !bytes.Contains(out, []byte("nothing to commit")) {
		return fmt.Errorf("git commit failed: %s", string(out))
	}

	if bytes.Contains(out, []byte("nothing to commit")) {
		log.Printf("Nothing to commit for: %s", msg)
		return nil
	}

	// Optional: git push. Only push if a remote exists.
	remoteCmd := exec.Command("git", "remote")
	remoteCmd.Dir = dir
	remoteOut, err := remoteCmd.Output()
	if err == nil && len(bytes.TrimSpace(remoteOut)) > 0 {
		pushCmd := exec.Command("git", "push")
		pushCmd.Dir = dir
		if pushOut, err := pushCmd.CombinedOutput(); err != nil {
			log.Printf("Warning: git push failed: %s", string(pushOut))
			// We don't fail the whole request if push fails (e.g. offline)
		} else {
			log.Printf("Pushed successfully")
		}
	}

	return nil
}
