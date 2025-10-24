// Dummy Python script generator based on user input
export const generatePythonScript = (userMessage: string): string => {
  const lowerMsg = userMessage.toLowerCase();

  // Data processing workflow
  if (lowerMsg.includes("data") || lowerMsg.includes("excel") || lowerMsg.includes("csv")) {
    return `import pandas as pd
import numpy as np
from pathlib import Path

def process_data(input_file: str, output_file: str):
    """
    Automated data processing pipeline
    Reads data, processes it, and exports results
    """
    print(f"Loading data from {input_file}...")
    
    # Read the data
    df = pd.read_excel(input_file) if input_file.endswith('.xlsx') else pd.read_csv(input_file)
    
    # Data cleaning
    print("Cleaning data...")
    df = df.dropna()  # Remove missing values
    df = df.drop_duplicates()  # Remove duplicates
    
    # Data transformation
    print("Transforming data...")
    # Add your custom transformations here
    df['processed_date'] = pd.Timestamp.now()
    
    # Export results
    print(f"Exporting results to {output_file}...")
    df.to_csv(output_file, index=False)
    print("Processing complete!")
    
    return df

if __name__ == "__main__":
    input_path = "input_data.xlsx"
    output_path = "processed_data.csv"
    
    result = process_data(input_path, output_path)
    print(f"\\nProcessed {len(result)} records successfully!")
`;
  }

  // Email automation
  if (lowerMsg.includes("email") || lowerMsg.includes("mail") || lowerMsg.includes("send")) {
    return `import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import pandas as pd

def send_automated_emails(recipient_list: list, subject: str, template: str):
    """
    Send personalized emails to multiple recipients
    """
    # Email configuration
    smtp_server = "smtp.gmail.com"
    smtp_port = 587
    sender_email = "your_email@gmail.com"
    sender_password = "your_app_password"
    
    print(f"Preparing to send {len(recipient_list)} emails...")
    
    # Connect to SMTP server
    with smtplib.SMTP(smtp_server, smtp_port) as server:
        server.starttls()
        server.login(sender_email, sender_password)
        
        for recipient in recipient_list:
            # Create message
            msg = MIMEMultipart()
            msg['From'] = sender_email
            msg['To'] = recipient['email']
            msg['Subject'] = subject
            
            # Personalize message
            body = template.format(**recipient)
            msg.attach(MIMEText(body, 'plain'))
            
            # Send email
            server.send_message(msg)
            print(f"✓ Email sent to {recipient['email']}")
    
    print("All emails sent successfully!")

if __name__ == "__main__":
    # Load recipient data
    recipients = [
        {"email": "user1@example.com", "name": "John", "company": "TechCorp"},
        {"email": "user2@example.com", "name": "Jane", "company": "DataInc"},
    ]
    
    email_template = """
    Hello {name},
    
    This is an automated message for {company}.
    
    Best regards,
    Automation System
    """
    
    send_automated_emails(recipients, "Automated Notification", email_template)
`;
  }

  // Web scraping
  if (lowerMsg.includes("scrape") || lowerMsg.includes("web") || lowerMsg.includes("crawl")) {
    return `import requests
from bs4 import BeautifulSoup
import pandas as pd
from time import sleep

def scrape_website(url: str, max_pages: int = 10):
    """
    Automated web scraping workflow
    Extracts data from multiple pages
    """
    all_data = []
    
    print(f"Starting scrape of {url}...")
    
    for page in range(1, max_pages + 1):
        try:
            # Fetch page
            response = requests.get(f"{url}?page={page}")
            response.raise_for_status()
            
            # Parse HTML
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Extract data (customize selectors)
            items = soup.find_all('div', class_='item')
            
            for item in items:
                data = {
                    'title': item.find('h2').text.strip(),
                    'description': item.find('p').text.strip(),
                    'link': item.find('a')['href']
                }
                all_data.append(data)
            
            print(f"✓ Scraped page {page}")
            sleep(1)  # Be respectful to the server
            
        except Exception as e:
            print(f"Error on page {page}: {e}")
            continue
    
    # Save to CSV
    df = pd.DataFrame(all_data)
    df.to_csv('scraped_data.csv', index=False)
    print(f"\\nScraped {len(all_data)} items successfully!")
    
    return df

if __name__ == "__main__":
    target_url = "https://example.com/listings"
    data = scrape_website(target_url, max_pages=5)
    print(data.head())
`;
  }

  // File automation
  if (lowerMsg.includes("file") || lowerMsg.includes("folder") || lowerMsg.includes("organize")) {
    return `import os
import shutil
from pathlib import Path
from datetime import datetime

def organize_files(source_dir: str, organize_by: str = 'extension'):
    """
    Automated file organization system
    Organizes files by type, date, or custom rules
    """
    source = Path(source_dir)
    print(f"Organizing files in {source_dir}...")
    
    file_types = {
        'Images': ['.jpg', '.jpeg', '.png', '.gif', '.bmp'],
        'Documents': ['.pdf', '.doc', '.docx', '.txt', '.xlsx'],
        'Videos': ['.mp4', '.avi', '.mkv', '.mov'],
        'Audio': ['.mp3', '.wav', '.flac'],
        'Code': ['.py', '.js', '.html', '.css', '.json']
    }
    
    moved_count = 0
    
    for file in source.iterdir():
        if file.is_file():
            # Get file extension
            ext = file.suffix.lower()
            
            # Find category
            category = 'Others'
            for cat, extensions in file_types.items():
                if ext in extensions:
                    category = cat
                    break
            
            # Create category folder
            dest_folder = source / category
            dest_folder.mkdir(exist_ok=True)
            
            # Move file
            dest_path = dest_folder / file.name
            shutil.move(str(file), str(dest_path))
            moved_count += 1
            print(f"✓ Moved {file.name} to {category}")
    
    print(f"\\nOrganized {moved_count} files successfully!")

if __name__ == "__main__":
    directory = "./Downloads"  # Change to your target directory
    organize_files(directory)
`;
  }

  // Default generic automation
  return `import sys
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def main():
    """
    Main automation workflow
    Customize this script based on your requirements
    """
    logging.info("Starting automation workflow...")
    
    try:
        # Your automation logic here
        print("Processing automation task...")
        
        # Example: Process data
        data = {
            'timestamp': datetime.now().isoformat(),
            'status': 'completed',
            'message': 'Automation executed successfully'
        }
        
        # Log results
        logging.info(f"Task completed: {data}")
        
        print("\\n✓ Automation completed successfully!")
        return data
        
    except Exception as e:
        logging.error(f"Error in automation: {e}")
        sys.exit(1)

if __name__ == "__main__":
    result = main()
    print(f"\\nResults: {result}")
`;
};
