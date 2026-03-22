// Static list of courses (each course contains multiple books)
import { staticBooks } from './books';

export const staticCourses = [
  {
    id: "course-1-science",
    title: "Science Fundamentals",
    description: "A comprehensive course covering all aspects of science including chemistry, physics, and biology",
    books: [
      staticBooks[0], // Science Grade 10 - Part I
      staticBooks[1], // Chemistry Fundamentals
      staticBooks[2], // Physics Principles
      staticBooks[3], // Biology Essentials
    ],
    totalSections: 546,
    objectives: [
      "Understand fundamental scientific principles",
      "Apply scientific methods to solve problems",
      "Analyze chemical reactions and processes",
      "Explore physical laws and their applications",
      "Study biological systems and organisms",
      "Develop critical thinking skills"
    ]
  },
  {
    id: "course-2-mathematics",
    title: "Mathematics & Advanced Topics",
    description: "Complete mathematics curriculum with advanced topics",
    books: [
      staticBooks[4], // Mathematics Advanced
    ],
    totalSections: 200,
    objectives: [
      "Master algebraic concepts and equations",
      "Understand geometric principles",
      "Apply calculus to real-world problems",
      "Develop mathematical reasoning"
    ]
  },
  {
    id: "course-3-humanities",
    title: "Humanities & Social Studies",
    description: "Explore literature, history, and geography",
    books: [
      staticBooks[5], // Classic Literature Collection
      staticBooks[6], // World History Overview
      staticBooks[7], // Geographic Studies
    ],
    totalSections: 370,
    objectives: [
      "Analyze literary works and themes",
      "Understand historical events and contexts",
      "Explore geographical concepts",
      "Develop cultural awareness",
      "Enhance reading comprehension"
    ]
  },
  {
    id: "course-4-complete",
    title: "Complete Curriculum",
    description: "All books across all subjects",
    books: staticBooks,
    totalSections: 1116,
    objectives: [
      "Comprehensive understanding of all subjects",
      "Cross-disciplinary knowledge integration",
      "Holistic educational development"
    ]
  }
];

