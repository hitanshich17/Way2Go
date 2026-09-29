# 🦅 PhillyPath — AI College Counselor for Every Philly Student

> **Philly Codefest 2026** | Theme: Building AI for Philly's Future | Track: Education & Youth Opportunity

---

## The Problem

Philadelphia's public school students deserve the same quality college guidance as students in wealthy districts — but the numbers tell a different story:

| | Philadelphia Schools | National Recommendation |
|---|---|---|
| Students per counselor | **491:1** | 250:1 |
| First-gen college students | **67%** | ~35% nationally |
| Scholarship $ unclaimed/year | **$150M+** | — |

First-generation students navigating college applications without guidance are significantly less likely to apply, less likely to complete applications correctly, and miss billions of dollars in available aid — not because they aren't capable, but because they don't have access to the knowledge.

**PhillyPath changes that.**

---

## What We Built

An **AI-powered college counselor** trained specifically on Philadelphia's education ecosystem. Think of it as a knowledgeable older sibling or mentor who knows every Philly scholarship, every program, every resource — available 24/7, completely free, in English and Spanish.

### Core Features

**🤖 AI Chat Counselor**
- Powered by Claude (Anthropic) with a knowledge base of Philadelphia-specific resources
- Conversational, warm, and encouraging — not robotic
- Answers questions about: scholarships, FAFSA, college applications, local colleges, internships, career paths
- Full bilingual support (English/Spanish)

**🎯 Opportunity Explorer**
- Curated database of 8+ scholarships and 12+ programs specific to Philadelphia
- Filter by type: scholarship, mentorship, internship, workforce
- "Ask AI" button on each card takes users directly into a counseling conversation about that opportunity
- Featured programs highlighted (Say Yes Philly, QuestBridge, Philadelphia Futures, CCP Promise)

**📊 Impact Dashboard**
- Real statistics about Philadelphia's education gap to contextualize the mission
- Shows students exactly what's available and why it matters

---

## Knowledge Base Highlights

PhillyPath knows about (and can provide detailed guidance on):

**Top Scholarships:**
- Say Yes Philadelphia — full tuition for all SDP graduates
- QuestBridge — full scholarships to top universities
- CCP Promise — free community college for Philly residents
- Jack Kent Cooke Foundation — up to $40,000/year
- Esperanza — supporting Latino/Hispanic students
- Philadelphia Foundation, Eagles Scholarship, and more

**Programs & Support:**
- Philadelphia Futures (first-gen mentorship)
- GEAR UP Philadelphia
- YouthBuild Philadelphia
- Philadelphia Youth Network (paid internships)
- CollegeSpring SAT prep
- CareerLink Youth Services

**Local College Navigation:**
- Temple, Drexel, Penn, CCP, La Salle, Saint Joseph's, Lincoln University (HBCU), and more

**Financial Aid:**
- FAFSA guidance (when to file, what to expect)
- PA State Grant (PHEAA)
- Federal Pell Grant
- Work-Study programs

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Custom CSS, Marked.js (markdown rendering) |
| Backend | Python FastAPI |
| AI | Claude (claude-sonnet-4-6) via Anthropic API |
| Knowledge | Custom Philadelphia education knowledge base (system prompt) |
| Deployment | Static frontend + Python server |

---

## Running the Project

### Prerequisites
- Python 3.10+
- Node.js (optional — frontend is plain HTML/JS)
- Anthropic API key

### Backend Setup

```bash
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your_key_here
python main.py
```

The API will run at `http://localhost:8000`

### Frontend

Simply open `frontend/index.html` in a browser.

The app works even without the backend running — it has a smart fallback with demo responses so judges can always see the full UI.

---

## Responsible AI Design

We took the "responsible AI" judging criteria seriously:

**Privacy:** No user accounts required. Conversations are never stored. No data is collected or sold.

**Accuracy:** The AI is grounded in a verified, curated knowledge base of real Philadelphia resources. It always encourages students to verify details directly with programs and to work with their school counselors.

**Equity:** Bilingual (English/Spanish). Designed specifically for students who lack access to guidance — not students who already have it. No barriers to access.

**Augmentation not replacement:** PhillyPath explicitly frames itself as a supplement to human counselors, not a replacement. It builds on and refers students to human experts.

**Transparency:** Students know they're talking to an AI. The app's mission and limitations are clearly communicated.

---

## Impact Potential

If deployed across Philadelphia's public schools:
- **203,000 students** could access personalized college counseling
- **$150M+** in unclaimed scholarships could be claimed
- **67%+ first-gen students** would have guidance previously unavailable to them
- Partnership path: School District of Philadelphia → statewide → national

---

## What's Next

- [ ] Real-time data sync with OpenDataPhilly for program updates
- [ ] SMS/text interface for students without reliable internet
- [ ] School counselor dashboard to track student progress
- [ ] Expand knowledge base with city job listings, trade apprenticeships
- [ ] Mobile app (React Native)
- [ ] Partnership with Philadelphia Education Fund for official deployment

---

## Team

Built with ❤️ for Philadelphia at Philly Codefest 2026.

*"Every student in this city deserves someone in their corner."*
