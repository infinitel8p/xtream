export async function injectExpirationDate(baseUrl, port="80", username, password) {
    const apiUrl = `${baseUrl}:${port}/player_api.php?username=${username}&password=${password}`;

    try {
        const response = await fetch(apiUrl);

        // Check for HTTP errors (like 451, 403, 404, etc.)
        if (!response.ok) {
            // Handle the legal/server errors here, perhaps show a detailed message
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // 2. Locate the expiration date in the response
        // It's typically found in the top-level 'user_info' object as 'exp_date' (a UNIX timestamp).
        const userInfo = data.user_info;

        if (userInfo && userInfo.exp_date) {
            const expTimestamp = parseInt(userInfo.exp_date, 10);

            // 3. Convert UNIX timestamp to a readable date string
            const expirationDate = new Date(expTimestamp * 1000); // Convert seconds to milliseconds

            // Format the date nicely (e.g., "Jan 1, 2026")
            const formattedDate = expirationDate.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            // 4. Inject the information into your HTML
            const expirationElement = document.getElementById('account-expiration');

            if (expirationElement) {
                expirationElement.textContent = `Account expires: ${formattedDate}`;
            } else {
                console.warn("Element with ID 'account-expiration' not found.");
            }

        } else {
            throw new Error("API response is missing 'user_info' or 'exp_date'. Check credentials and API format.");
        }

    } catch (e) {
        console.error('Could not get Xtream account info:', e);
        // Display a failure message to the user
        const expirationElement = document.getElementById('account-expiration');
        if (expirationElement) {
            expirationElement.textContent = "";
        }
    }
}