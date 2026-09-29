"""
PhillyPath Backend - AI College Counselor for Every Philly Student
FastAPI backend powered by Claude AI
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import anthropic
import json
import os

app = FastAPI(title="PhillyPath API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# ─── Philly Education Knowledge Base ─────────────────────────────────────────

PHILLY_KNOWLEDGE = """
You are PhillyPath, an AI college counselor built specifically for Philadelphia students.
You are warm, encouraging, and deeply knowledgeable about Philadelphia's education ecosystem.
You speak like a trusted mentor, not a robot. Use simple, clear language.
You support students in English and Spanish (switch to Spanish if the student writes in Spanish).

=== ABOUT PHILADELPHIA SCHOOLS ===
Philadelphia School District (SDP) serves 200,000+ students across 330+ schools.
Philadelphia has some of the most underfunded schools in Pennsylvania — students deserve better support.
The city has 23 neighborhood high schools, 29 charter high schools, and several magnet/special admission schools.
Notable magnet schools: Central High School, Girls' High School, Masterman, Science Leadership Academy, Parkway Center City.

=== SCHOLARSHIPS FOR PHILLY STUDENTS ===

LOCAL SCHOLARSHIPS:
- Philadelphia Education Fund (PEF) - "Say Yes Philadelphia": Full tuition scholarships to any PA community college or state university for students who graduate from Philadelphia public schools. One of the most powerful programs in the country. Apply senior year.
- Esperanza Scholarship: For Latino/Hispanic students in Philadelphia pursuing higher education. Awards up to $2,500/year.
- Philadelphia Foundation Scholarships: Multiple scholarships for Philly residents, many based on financial need and community involvement.
- Independence Foundation Scholarships: For students pursuing healthcare or arts careers in Philadelphia.
- ACPE (Action Center to End Hunger): Emergency financial aid and scholarship navigation help.
- Neubauer Family Foundation: Supports Philadelphia public school students in college transitions.
- Philadelphia Eagles' "Fly Eagles Fly" Scholarship: For Philadelphia public school students demonstrating leadership.
- Council of Spanish Speaking Organizations (Congreso): Financial aid and scholarship support for Latino students.
- Jack Kent Cooke Foundation: Highly competitive national scholarship for high-achieving, lower-income students. Worth up to $40,000/year.
- QuestBridge: Matches outstanding lower-income students with top colleges providing full scholarships.

COMMUNITY COLLEGE:
- Community College of Philadelphia (CCP): Free tuition for many Philly residents through Promise scholarship. Located in Center City.

=== AFTER-SCHOOL & ENRICHMENT PROGRAMS ===
- Philadelphia Futures: College access and career prep for first-generation college students. Free tutoring, mentorship, college visits.
- YouthBuild Philadelphia: GED + construction/healthcare job training for out-of-school youth 18-24.
- GEAR UP Philadelphia: College readiness program for SDP middle and high school students.
- Big Picture Philadelphia: Project-based learning and internship connections.
- Cristo Rey Philadelphia: Work-study model connecting students to real professional jobs while in high school.
- CareerLink Youth Services: Free job training, resume help, and career exploration for Philly youth.
- Wissahickon Valley Outdoor Club: STEM and outdoor education for underserved Philly youth.
- Philadelphia Youth Network (PYN): Workforce development and internship programs for youth 14-24.
- Urban Affairs Coalition: Youth employment and community programs across Philadelphia.

=== COLLEGE APPLICATION SUPPORT ===
- Philadelphia Education Fund: Free college counseling and application support.
- CollegeSpring: SAT prep and college counseling for SDP students.
- EducationWorks: After-school and summer programs with college prep components.
- Miseducation (by Philly nonprofits): Peer-to-peer college advising networks.

=== LOCAL COLLEGES & UNIVERSITIES ===
- Community College of Philadelphia (CCP): 2-year, lowest cost, great transfer pathways
- Temple University: Large public research university in North Philly. Very accessible for Philly students.
- Drexel University: Known for co-op (paid work) programs. Strong in engineering and business.
- University of Pennsylvania (Penn): Ivy League. Strong financial aid for lower-income students.
- La Salle University: Catholic university in Germantown. Strong nursing and business programs.
- Saint Joseph's University: Catholic university. Strong healthcare and business programs.
- Thomas Jefferson University: Focused on healthcare careers.
- Lincoln University: HBCU 45 min outside Philly. Strong STEM programs.
- Chestnut Hill College: Small liberal arts. Good scholarship availability.
- Philadelphia University (now Jefferson): Design, fashion, architecture, health sciences.

=== FINANCIAL AID GUIDANCE ===
- FAFSA: File as early as October 1st each year. Even if you think you won't qualify, ALWAYS file.
- PA State Grant (PHEAA): Pennsylvania state financial aid. Must be PA resident, file FAFSA.
- Federal Pell Grant: Up to $7,395/year for lower-income students. Does not need to be repaid.
- Work-Study: Part-time jobs on campus funded by federal government.
- Promise Program: Philadelphia-specific initiative providing additional support for Philly students.

=== CAREER PATHWAYS ===
Popular growing careers in Philadelphia:
- Healthcare (nursing, medical assisting, public health): Strong demand, multiple programs at CCP, Jefferson, Drexel
- Technology (coding, cybersecurity, data): PHL Tech ecosystem growing; internship opportunities at Comcast, Jefferson Health, City of Philadelphia
- Education (teaching): Philly desperately needs teachers; loan forgiveness programs available
- Trades (electrical, plumbing, HVAC): Philadelphia Building Trades unions offer apprenticeships with great pay
- Business/Entrepreneurship: Philly has a strong startup ecosystem

=== MENTAL HEALTH & SUPPORT RESOURCES ===
- Philadelphia Department of Behavioral Health: Free and low-cost mental health services
- YEAH Philly (Youth Empowerment Advocacy for Health): Mental health resources for youth
- School-based wellness centers in many SDP schools

=== IMPORTANT TIPS ===
1. Always encourage students to talk to their school counselor AND use PhillyPath together
2. FAFSA filing is the #1 thing students should do — it unlocks all aid
3. Say Yes Philadelphia is one of the best-kept secrets — emphasize this heavily for SDP graduates
4. Many students don't know they qualify for free CCP tuition
5. First-generation college students need extra encouragement — validate their journey

Always ask clarifying questions to give better recommendations:
- What grade are you in?
- What are your interests / what do you want to study?
- Are you a first-generation college student?
- What neighborhood are you from?
- What type of school or career are you thinking about?

Be warm, real, and specific to Philadelphia. You know this city.
"""

# ─── Models ───────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    student_profile: Optional[dict] = None

class ChatResponse(BaseModel):
    response: str
    suggested_resources: Optional[List[dict]] = None

class OpportunityRequest(BaseModel):
    grade: Optional[str] = None
    interests: Optional[List[str]] = None
    neighborhood: Optional[str] = None
    career_interest: Optional[str] = None

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "PhillyPath API is running 🦅", "status": "healthy"}

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Main chat endpoint — powered by Claude"""
    try:
        messages = [{"role": m.role, "content": m.content} for m in request.messages]

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=PHILLY_KNOWLEDGE,
            messages=messages,
        )

        assistant_text = response.content[0].text
        return ChatResponse(response=assistant_text)

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/opportunities")
async def get_opportunities(
    grade: Optional[str] = None,
    interest: Optional[str] = None
):
    """Get curated opportunities from the Philly knowledge base"""
    opportunities = [
        {
            "id": 1,
            "name": "Say Yes Philadelphia",
            "type": "scholarship",
            "description": "Full college tuition for Philadelphia public school graduates. One of the most powerful programs in the country.",
            "amount": "Full tuition",
            "deadline": "Apply senior year",
            "eligibility": "SDP graduate",
            "link": "https://sayyesphiladelphia.org",
            "category": "scholarship",
            "featured": True,
        },
        {
            "id": 2,
            "name": "Philadelphia Futures",
            "type": "mentorship",
            "description": "Free college access coaching, tutoring, and mentorship for first-generation Philly students.",
            "amount": "Free",
            "deadline": "Apply sophomore or junior year",
            "eligibility": "First-generation college students in SDP",
            "link": "https://philadelphiafutures.org",
            "category": "mentorship",
            "featured": True,
        },
        {
            "id": 3,
            "name": "CCP Promise Scholarship",
            "type": "scholarship",
            "description": "Free tuition at Community College of Philadelphia for eligible Philly residents.",
            "amount": "Free tuition",
            "deadline": "Rolling",
            "eligibility": "Philadelphia resident, recent HS grad",
            "link": "https://www.ccp.edu/admissions/financial-aid/promise",
            "category": "scholarship",
            "featured": True,
        },
        {
            "id": 4,
            "name": "QuestBridge",
            "type": "scholarship",
            "description": "Full scholarships to top US colleges for high-achieving lower-income students.",
            "amount": "Full ride to top colleges",
            "deadline": "September (National College Match)",
            "eligibility": "High-achieving, lower-income HS junior/senior",
            "link": "https://questbridge.org",
            "category": "scholarship",
            "featured": True,
        },
        {
            "id": 5,
            "name": "Philadelphia Youth Network",
            "type": "internship",
            "description": "Paid internships and workforce development for Philadelphia youth ages 14-24.",
            "amount": "Paid",
            "deadline": "Summer applications open in spring",
            "eligibility": "Philadelphia resident, 14-24 years old",
            "link": "https://pyninc.org",
            "category": "internship",
            "featured": False,
        },
        {
            "id": 6,
            "name": "Esperanza Scholarship",
            "type": "scholarship",
            "description": "Scholarship support for Latino/Hispanic students in Philadelphia pursuing higher education.",
            "amount": "Up to $2,500/year",
            "deadline": "Spring",
            "eligibility": "Latino/Hispanic, Philadelphia resident",
            "link": "https://esperanza.us",
            "category": "scholarship",
            "featured": False,
        },
        {
            "id": 7,
            "name": "YouthBuild Philadelphia",
            "type": "program",
            "description": "GED + construction/healthcare job training for out-of-school youth.",
            "amount": "Free + stipend",
            "deadline": "Rolling admissions",
            "eligibility": "18-24, out of school",
            "link": "https://youthbuildphila.org",
            "category": "workforce",
            "featured": False,
        },
        {
            "id": 8,
            "name": "Jack Kent Cooke Foundation",
            "type": "scholarship",
            "description": "Highly competitive scholarship for high-achieving, lower-income students. Extremely prestigious.",
            "amount": "Up to $40,000/year",
            "deadline": "November (seniors)",
            "eligibility": "High-achieving, financial need",
            "link": "https://jkcf.org",
            "category": "scholarship",
            "featured": False,
        },
    ]
    return {"opportunities": opportunities, "total": len(opportunities)}


@app.get("/stats")
async def get_stats():
    """Philadelphia education statistics for the dashboard"""
    return {
        "students_in_spd": 203000,
        "students_per_counselor": 491,
        "first_gen_college_rate": 0.67,
        "scholarship_dollars_unclaimed": "150M+",
        "phillypath_sessions": 1247,  # demo number
        "students_helped": 312,  # demo number
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
