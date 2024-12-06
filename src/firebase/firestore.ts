import { db } from './config';
import { doc, setDoc, getDoc, updateDoc, collection, getDocs } from 'firebase/firestore';
import type { Folder } from '@/types/materials';

interface UserData {
  tasks: Array<{
    name: string;
    time: string;
    progress?: number;
  }>;
  assignments: Array<{
    name: string;
    date: string;
    progress?: number;
  }>;
  exams: Array<{
    name: string;
    date: string;
  }>;
  records: Array<{
    name: string;
    date: string;
  }>;
  folders: Array<{
    id: string;
    name: string;
    tags: string[];
    files: Array<{
      id: string;
      name: string;
      url: string;
      type: string;
      createdAt: string;
    }>;
    createdAt: string;
  }>;
}

export const initializeUserData = async (userId: string, email: string) => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    // Check if this is the first user (make them admin)
    const usersSnapshot = await getDocs(collection(db, 'users'));
    const isFirstUser = usersSnapshot.empty;
    
    await setDoc(userRef, {
      email,
      role: isFirstUser ? 'admin' : 'user',
      username: email.split('@')[0],
      tasks: [],
      assignments: [],
      exams: [],
      records: [],
      folders: []
    });
  }
};

export const updateUserTasks = async (userId: string, tasks: UserData['tasks']) => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { tasks });
};

export const updateUserAssignments = async (userId: string, assignments: UserData['assignments']) => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { assignments });
};

export const updateUserExams = async (userId: string, exams: UserData['exams']) => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { exams });
};

export const updateUserRecords = async (userId: string, records: UserData['records']) => {
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { records });
};

export const updateUserFolders = async (userId: string, folders: Folder[]) => {
  const foldersRef = doc(db, 'folders', 'global');
  await setDoc(foldersRef, { folders }, { merge: true });
};

export const getUserData = async (userId: string): Promise<UserData | null> => {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    return userSnap.data() as UserData;
  }
  return null;
};

export const getUserFolders = async () => {
  try {
    const foldersRef = doc(db, 'folders', 'global');
    const docSnap = await getDoc(foldersRef);
    
    if (!docSnap.exists()) {
      await setDoc(foldersRef, { folders: [] });
      return [];
    }
    
    return docSnap.data().folders as Folder[];
  } catch (error) {
    console.error('Error fetching folders:', error);
    return [];
  }
};
